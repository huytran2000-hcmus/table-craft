# Plan: Ship the PostgreSQL and MySQL plugins behind one contract suite

Status: done. PostgreSQL (`pg` + `pg-cursor`) and MySQL (`mysql2`) ship as built-in plugins
beside SQLite, all three pass one contract suite against the same seeded `type_probe`, and the app,
pointed at each through `TABLE_CRAFT_DATASOURCE`, draws identical cells for
`SELECT * FROM type_probe` and cancels `pg_sleep(30)` / `SLEEP(30)` from a Cancel button long before
they would end. The live test found three bugs no unit test could: the built Postgres and MySQL bundles
could not load in the engine at all (CommonJS drivers in an ESM bundle without `require`), the grid
clipped CJK and emoji, and error message and hint ran together. Reality also differed in the
build (one Vite run per plugin), in how a `PluginError` is recognised across bundles, and in the
engine gaining `connectionFailed` and `cancelled` error codes.

## The issue

Only SQLite exists (`plugins/sqlite/src/index.ts`). `plugins/postgres/` and `plugins/mysql/` hold
a `package.json` and nothing else, `bun run test:db` points at a `test/db/compose.yml` and a
`vitest.db.config.ts` that do not exist (`package.json:24`), and the contract suite
(`packages/plugin-api/src/testing/index.ts:35`) covers four `SELECT`/`INSERT` cases. Every later
plan (explorer, console, editor) has to work on three databases, so the three must exist and
agree before any of them starts.

Two gaps are not about new drivers but would bite them first:

| #   | Gap                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Values: the contract never checks how a driver's types cross the wire. `pg` returns `int8` and `numeric` as strings, `timestamp` as a local-time `Date`; `mysql2` returns `DECIMAL` as string, `JSON` parsed, `DATETIME` as `Date` in the client time zone. Unchecked, the grid will show shifted timestamps and lose precision |
| 2   | Cancel: `Session` (`packages/plugin-api/src/plugin.ts:29`) has no way to stop a running statement, so a `pg_sleep(600)` hangs a console until the engine is killed                                                                                                                                                              |

The driving case is the same logical fixture schema seeded into all three databases, and the app
running `SELECT * FROM type_probe` against each, showing identical cells.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `plugins/postgres` uses `pg` with `pg-cursor` for streaming; `plugins/mysql` uses `mysql2` (callback API, `query().stream()`). Both pure JS (decision 001)                                                                                                                                 |
| 2   | Rows stream: neither plugin buffers a whole result. The host's fetch cap (`packages/core/src/results/store.ts:7`) stops the iterator, and `return()` must close the cursor or stream                                                                                                       |
| 3   | Temporal values (`date`, `time`, `timestamp`, `timestamptz`, `DATETIME`, `TIMESTAMP`) cross as the database's own text, as strings. No JS `Date` is constructed, so no time-zone shift is possible — matches what DataGrip shows. `pg` type parsers and mysql2 `dateStrings: true` do this |
| 4   | Exact numerics (`numeric`, `DECIMAL`) cross as strings; 64-bit integers cross as numbers when safe and as the `bigint` tag otherwise, as SQLite already does (`plugins/sqlite/src/index.ts:28`)                                                                                            |
| 5   | `json` / `jsonb` / MySQL `JSON` cross as the `json` tag with the database's text; binary (`bytea`, `BLOB`, `BINARY`) as the `bytes` tag                                                                                                                                                    |
| 6   | New capability `cancel` with `Session.cancel(): Promise<void>`. Postgres sends `pg_cancel_backend(pid)` on a short-lived second connection; MySQL sends `KILL QUERY <threadId>` the same way. A cancelled `execute` rejects with a plugin error whose code is `cancelled`                  |
| 7   | SQLite does not declare `cancel` in v1: `node:sqlite` is synchronous on the engine thread, so nothing can run while a statement does. The UI hides Cancel when the capability is absent (decision 007)                                                                                     |
| 8   | `API_VERSION` becomes `0.2.0` (`packages/plugin-api/src/version.ts:5`); SQLite's manifest follows                                                                                                                                                                                          |
| 9   | `ContractFixture` gains the dialect statements the suite cannot write portably: `sleep(seconds)` and the fixture's expected `type_probe` rows. The suite asserts the same logical rows across dialects                                                                                     |
| 10  | Docker images: `postgres:17-alpine` and `mysql:8.4`, ports `55432` and `53306` so a developer's own databases on the default ports are untouched                                                                                                                                           |
| 11  | Until plan 004 adds connections, main picks its datasource from `TABLE_CRAFT_DATASOURCE` (JSON `{ id, pluginId, config }`) and falls back to the in-memory SQLite one (`packages/desktop/src/main/main.ts:8`). This is a development seam and is documented as such                        |
| 12  | Protocol gains `statement.cancel`; `session.open` returns the plugin's capabilities so the renderer can gate the Cancel button                                                                                                                                                             |

### Consequences worth naming

**This changes the plugin contract.** `Capability` gains `cancel`, `Session` gains an optional
`cancel`, `API_VERSION` moves to `0.2.0`, and `ContractFixture` gains fields. Any plugin built
against `0.1.0` stops loading, which today is only SQLite.

**This crosses the fence.** `statement.cancel` (renderer → engine) and capabilities in the
`session.open` result.

**This default was chosen without asking.** Temporal values as database text rather than the
`date` tag. The tag stays in `WireValue` for plugins that only have a `Date`.

---

## Phase 0 — contract and fixture

- `packages/plugin-api/src/plugin.ts`: `CAPABILITIES = ["sql", "cancel"]`, `Session.cancel?()`,
  and a `PluginError` with a `code` (`cancelled`, `connectionFailed`, `statementFailed`) exported
  for plugins to throw.
- `packages/plugin-api/src/version.ts`: `API_VERSION = "0.2.0"`; `plugins/sqlite/table-craft-plugin.json`
  follows.
- `packages/plugin-api/src/testing/index.ts`: `ContractFixture` gains `statements.sleep` and
  `typeProbe.expected`; new cases below.
- `test/db/schema/{postgres,mysql,sqlite}.sql`: the fixture schema — `customers`, `orders` (FK to
  `customers`), `type_probe` with one row per interesting value: small int, int beyond 2^53,
  decimal with 20 digits, text with Unicode, boolean, JSON, bytes, date, timestamp, null.

## Phase 1 — plugins

| File                                               | Responsibility                                                                                                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugins/postgres/src/index.ts`                    | `connectionSchema` (host, port, database, user, password, ssl mode), session on `pg.Client`, cursor streaming, type parsers per decisions 3–5, cancel via second connection |
| `plugins/mysql/src/index.ts`                       | same on `mysql2`: `supportBigNumbers`, `bigNumberStrings`, `dateStrings`, JSON to `json` tag, `KILL QUERY` cancel                                                           |
| `plugins/{postgres,mysql}/table-craft-plugin.json` | manifest, `highlight` `postgresql` / `mysql`                                                                                                                                |
| `vite.plugins.config.ts`                           | bundles both; `pg-native` stays external and unused                                                                                                                         |

## Phase 2 — test:db and the app seam

- `test/db/compose.yml`: both services with health checks, seeded from `test/db/schema/`.
- `vitest.db.config.ts`: includes `test/db/**/*.test.ts`; `test/db/postgres.test.ts` and
  `test/db/mysql.test.ts` call `runPluginContract`.
- `packages/desktop/src/main/main.ts`: decision 11.
- `engine/protocol.ts`, `engine/requests.ts`, `engine/engine.ts`: `statement.cancel`; capabilities
  on `session.open`.
- Renderer: a Cancel button beside Run, shown when `cancel` is declared, enabled while a statement
  runs.

## Phase 3 — Fixtures, tests, docs

New cases in the contract suite:

`givenTypeProbe_whenSelected_thenCellsMatchExpectedWireValues`,
`givenTimestamp_whenSelected_thenTextIsUnshiftedByClientTimeZone` (run with `TZ` set away from UTC),
`givenLargeResult_whenIteratorReturnedEarly_thenCursorClosedAndSessionUsable`,
`givenSleepingStatement_whenCancelled_thenExecuteRejectsWithCancelled`,
`givenCancelledStatement_whenNextStatementRun_thenSessionStillWorks`,
`givenWrongPassword_whenConnecting_thenRejectsWithConnectionFailed`.

Unit tests: `givenManifestWithApiVersion010_whenLoaded_thenPluginUnavailable`,
`givenDatasourceEnv_whenMainStarts_thenUsesItsPlugin` (pure helper that parses the env),
`givenCancelRequest_whenEngineHasNoCancelCapability_thenInvalidRequestError`.

Docs: `docs/design/specification.md` plugin-contract section gains `cancel`, `PluginError`, the
value rules of decisions 3–5; AGENTS.md mentions `TABLE_CRAFT_DATASOURCE`.

Every phase ends with `bun run typecheck` and `bun run test` green; phases 1–3 also run
`bun run test:db`.

---

## Live test

The built app (`packages/desktop/dist`) driven by Playwright `_electron` through
`test/e2e/databases.smoke.test.ts`, each scenario in a fresh app with `TABLE_CRAFT_DATASOURCE`
pointing at the `test/db/compose.yml` Postgres and MySQL or a freshly seeded SQLite file. Rerun with
`TABLE_CRAFT_EVIDENCE_DIR=docs/evidence/002 bun run test:smoke:db` (15 passed, 2 skipped: SQLite
declares no `cancel` and has no password). Every screenshot was opened and checked by eye.

| #   | Scenario                                                                                    | Database | Result                                                                                                                                                                                                                                                                                                                                                      | Evidence                                           |
| --- | ------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1   | `SELECT * FROM type_probe`; Cancel button present                                           | postgres | Bug: the app never connected — the built bundle threw ``Calling `require` for "events"``. Fixed with `platform: "node"` in `vite.plugins.config.ts`; regression `test/e2e/builtPlugins.smoke.test.ts`. Second bug: `héllo, 世界 🌍` clipped; fixed by counting wide characters in `grid/widths.ts`, regression `test/desktop/gridWidths.test.ts`. Then pass | `docs/evidence/002/postgres-type-probe.png`        |
| 2   | `SELECT * FROM type_probe`; Cancel button present                                           | mysql    | Pass after the bundle fix in row 1; cells identical to row 1                                                                                                                                                                                                                                                                                                | `docs/evidence/002/mysql-type-probe.png`           |
| 3   | `SELECT * FROM type_probe`; no Cancel button                                                | sqlite   | Pass; cells identical to rows 1 and 2                                                                                                                                                                                                                                                                                                                       | `docs/evidence/002/sqlite-type-probe.png`          |
| 4   | `SELECT pg_sleep(30)`, Cancel clicked after 500 ms; then `type_probe` runs                  | postgres | Pass: "The statement was cancelled." inside the 10 s deadline, session reused                                                                                                                                                                                                                                                                               | `docs/evidence/002/postgres-cancelled.png`         |
| 5   | `SELECT SLEEP(30)`, Cancel clicked after 500 ms; then `type_probe` runs                     | mysql    | Pass, same as row 4                                                                                                                                                                                                                                                                                                                                         | `docs/evidence/002/mysql-cancelled.png`            |
| 6   | `SELEC * FROM type_probe` shows the driver's error; the next statement runs                 | postgres | Bug: message and hint ran together. Fixed in `Console.tsx` (hint as its own muted span), asserted by the alert text in `databases.smoke.test.ts`. Then pass                                                                                                                                                                                                 | `docs/evidence/002/postgres-invalid-statement.png` |
| 7   | Same                                                                                        | mysql    | Pass                                                                                                                                                                                                                                                                                                                                                        | `docs/evidence/002/mysql-invalid-statement.png`    |
| 8   | Same                                                                                        | sqlite   | Pass                                                                                                                                                                                                                                                                                                                                                        | `docs/evidence/002/sqlite-invalid-statement.png`   |
| 9   | App started with a wrong password: "Could not connect: …" with its hint, Run stays disabled | postgres | Pass                                                                                                                                                                                                                                                                                                                                                        | `docs/evidence/002/postgres-wrong-password.png`    |
| 10  | Same                                                                                        | mysql    | Pass                                                                                                                                                                                                                                                                                                                                                        | `docs/evidence/002/mysql-wrong-password.png`       |

---

## Deviations taken while implementing

**1. One Vite run per plugin, chosen with `--mode <id>`.** Rolldown refuses several inputs while
`codeSplitting` is off, and turning it on would share chunks between plugins that must each stand
alone in their own directory. `BUILT_IN_PLUGINS` in `packages/desktop/vite.plugins.config.ts` is the
list; `test/desktop/build.test.ts` pins it to the plugin directories and to the build script.

**2. Plugin bundles are built with `platform: "node"`.** `pg` and `mysql2` are CommonJS and
`require` Node built-ins; an ESM bundle without it fails at import inside the engine. Vitest and
`node -e` both provide a global `require`, so only a child `node --input-type=module` process
(`test/e2e/builtPlugins.smoke.test.ts`) sees the failure.

**3. `PluginError` is recognised with `isPluginError`, not `instanceof`.** Each built plugin
bundles its own copy of `@table-craft/plugin-api`, so its class is not the host's. The check is by
`name` and a known `code`.

**4. The engine gained `connectionFailed` and `cancelled` error codes.** Mapping a refused password
to `statementFailed` or `internal` would give the user the wrong next step; each code carries its
own hint.

**5. `session.open` also returns `pluginName`.** The console shows which database it talks to;
the manifest name is display-only and the UI still branches on capabilities alone (decision 007).

**6. A session runs one statement at a time; a second `execute` rejects `statementFailed`.**
Neither driver multiplexes a connection, and `cancel` must know which statement it stops. The
console's Run button is already disabled while a statement runs.

**7. `execute` resolves after the first batch (Postgres) or first row (MySQL), not after the row
description.** Until then the statement is running on the server: `SELECT SLEEP(30)` sends its
column before it sleeps, so resolving on fields would end the "running" state and make Cancel a
no-op. MySQL's interrupted `SLEEP` returns 1 instead of an error, so the plugin remembers that a
cancel was requested and rejects `cancelled` itself.

**8. SQLite maps declared `BOOLEAN` and `JSON` columns, and its `type_probe` keeps decimal and
temporal values as `TEXT`.** SQLite has no such types; without the declared-type mapping its row
would differ from the other two, and a `REAL` decimal would lose the 20 digits the probe checks.
Recorded with the other value rules in decision 017.

**9. The contract suite grew beyond the six named cases.** Invalid SQL must reject
`statementFailed`, a failed statement must leave the session usable, and an idle `cancel` must be a
no-op; the UI relies on all three. The large-result case reads 3 of
100 000 rows from a portable cross join of digit tables.

**10. Grid columns are sized from their content, capped by a token.** With one fixed width the
`type_probe` evidence was unreadable. `gridColumnWidthPx` became `gridColumnMaxWidthPx`
(`grid/widths.ts`, from the header and the first window, CJK and emoji counted as two cells).

**11. The MySQL seed starts with `SET NAMES utf8mb4`.** The image's init client defaults to
`latin1` and double-encoded the Unicode probe text.

**12. The live test is a gated e2e suite.** `test/e2e/harness.ts` (launch with a datasource, run,
read the grid, capture) and `test/e2e/databases.smoke.test.ts` run under `bun run test:smoke:db`;
plain `test:smoke` skips them, so it still needs no Docker.

---

## Out of scope

- Introspection and the explorer tree: plan 005.
- Transactions and auto/manual commit: plan 006 (console).
- SSL certificates beyond `sslmode`, SSH tunnels: v1.1.
- Cancel for SQLite: would need the plugin to run `node:sqlite` in a worker thread; revisit if
  long SQLite queries prove common.
