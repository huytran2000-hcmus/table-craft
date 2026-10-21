# Plan: Ship the PostgreSQL and MySQL plugins behind one contract suite

Status: not started

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

_To be filled in. At minimum: the app against Postgres, MySQL and SQLite running
`SELECT * FROM type_probe` (one screenshot each, cells identical); `SELECT pg_sleep(30)` and
`SELECT SLEEP(30)` cancelled from the button; an invalid statement showing its error._

---

## Deviations taken while implementing

---

## Out of scope

- Introspection and the explorer tree: plan 005.
- Transactions and auto/manual commit: plan 006 (console).
- SSL certificates beyond `sslmode`, SSH tunnels: v1.1.
- Cancel for SQLite: would need the plugin to run `node:sqlite` in a worker thread; revisit if
  long SQLite queries prove common.
