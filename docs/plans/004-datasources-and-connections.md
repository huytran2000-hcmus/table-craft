# Plan: Manage datasources and connect to many at once

Status: done. table-craft now keeps a list of datasources instead of one from the environment. Main
owns `datasources.json` (atomic, versioned, a corrupt file set aside with a warning) and the
secrets in their three save modes, with Forever encrypted by `safeStorage` and no plaintext
fallback; the renderer sees which secrets are stored, never their values. Connection forms come from
the manifests' new `connection.fields`, which the contract checks against each plugin's schema.
Every connected datasource has its own engine and port, so PostgreSQL, MySQL and SQLite consoles run
side by side; Test Connection runs in a throwaway probe engine, read-only is enforced in each
plugin's session, and plugin-api is `0.3.0` with `serverVersion` and `connect(config, { readOnly })`.
The Database pane is a folder tree with colours, statuses and a context menu, and the Data Sources
dialog follows DataGrip's. All twelve live-test rows pass; the screenshots exposed five bugs (a
crashed engine's console claiming to be merely disconnected, a truncated Test Connection error, a
delete prompt mentioning a password SQLite never had, a generic hint on read-only writes, and
evidence 32 px short), each fixed with a test. Reality differed mostly in how a connection ends:
Disconnect goes through main, and Run on a disconnected or failed console reconnects (decision 021).

## The issue

The app connects to exactly one database, chosen by `TABLE_CRAFT_DATASOURCE` at launch
(`packages/desktop/src/main/datasource.ts:24`), or to in-memory SQLite when it is unset. Every
window gets one engine port (`main/main.ts`, `ipcMain.on(CHANNELS.connectEngine…)`), and the
renderer assumes one datasource: `state/consoles.ts:40-52` keeps a single `DatasourceState`, the
Database pane shows one node labelled "Datasource" until a connection succeeds (plan 003 live
test row 9), and the status bar names one database.

A DataGrip user expects the opposite: a persistent list of datasources in folders, a Data Sources
dialog with a form per database type, Test Connection, saved passwords, and several connections
open side by side, each console attached to one of them. Without that, nothing after this plan
(explorer, console, editor) has a datasource to belong to.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Main owns the datasource list in `<userData>/datasources.json` (`{ version: 1, datasources: [...] }`), written atomically (temp file + rename) and migrated by `version` on load (decision 010)                                                                                                                                                                                                                          |
| 2   | A datasource is `{ id (uuid), name, pluginId, folder: string \| null, color: string \| null, readOnly, comment, config (non-secret values), secretModes: Record<fieldKey, "forever" \| "untilRestart" \| "never"> }`                                                                                                                                                                                                     |
| 3   | Connection forms come from `connection.fields` in each manifest (decision 019). Main discovers manifests with core's discovery, without importing plugin code                                                                                                                                                                                                                                                            |
| 4   | Secrets follow decision 020: Forever via `safeStorage` in `<userData>/secrets.json`, Until restart in main's memory, Never prompted per connect. A secret never reaches a renderer                                                                                                                                                                                                                                       |
| 5   | Renderer ↔ main uses `ipcRenderer.invoke` channels for the list (`datasources.list`, `datasources.save`, `datasources.delete`, `datasources.test`, `plugins.list`) and a `datasources.changed` broadcast. Main is in the settings path, still not in the request path                                                                                                                                                    |
| 6   | `connectEngine(datasourceId)` replaces the argument-less call. Main decrypts secrets, forks or reuses that datasource's host, and hands the window a port tagged with the datasource id. A window holds one port per connected datasource                                                                                                                                                                                |
| 7   | A Never secret that main lacks makes `connectEngine` answer `needsSecrets: [fieldKeys]`; the renderer shows a password dialog and calls again with the values, which main passes to the boot and drops                                                                                                                                                                                                                   |
| 8   | Test Connection forks a probe engine (`engine.boot` with `mode: "probe"`) that connects, reads the server version, closes and exits; main kills it after `PROBE_TIMEOUT_MS = 15_000`. The result shows "Succeeded · PostgreSQL 17.4 · 38 ms" or the plugin's error and hint                                                                                                                                              |
| 9   | plugin-api gains `Session.serverVersion: string \| null` and `connect(config, { readOnly })`. Read-only is enforced in the session: PostgreSQL `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`, MySQL `SET SESSION TRANSACTION READ ONLY`, SQLite `PRAGMA query_only = ON` (decision 011). `API_VERSION` 0.3.0                                                                                                    |
| 10  | An engine lives while any port to it is open. Disconnect closes the datasource's sessions and ports; the engine exits on its last port closing. Main broadcasts `engine.exited { datasourceId, code }`, and the renderer marks the node "disconnected" (clean) or "failed: engine exited" (crash). No idle timeout in v1                                                                                                 |
| 11  | The renderer keys connection state by datasource id (`state/datasources.ts`: list from main plus `{ status, error, pluginName, capabilities, serverVersion }` per id). A console carries `datasourceId`; `state/consoles.ts` opens its session on that datasource's port                                                                                                                                                 |
| 12  | The Database pane lists datasources in folders. A folder is a `/`-separated path, so `Prod/EU` nests. Each node shows the plugin icon, name, colour swatch and status; a failed node is labelled with its datasource name (fixes plan 003's "Datasource" gap)                                                                                                                                                            |
| 13  | The Data Sources dialog follows DataGrip: datasource list on the left, form on the right with Name, Folder, Comment, the plugin's General fields, an Advanced section, an Options section (Read-only, Colour), save mode beside each secret, Test Connection, OK / Cancel / Apply                                                                                                                                        |
| 14  | Actions (decision 015): `datasource.new` (Mod+N in the Database pane, else from the `+` button and menu), `datasource.properties` (Mod+;), `datasource.duplicate` (Mod+D), `datasource.delete` (Delete, confirms and closes its consoles), `datasource.connect`, `datasource.disconnect` (Mod+F2), `datasource.newFolder`, `datasource.moveToFolder`, and `console.new` (Mod+Shift+L) opening on the selected datasource |
| 15  | A datasource's colour tints its tabs, its console's border and its tree node; the tab label reads `console [name]` as in DataGrip                                                                                                                                                                                                                                                                                        |
| 16  | `TABLE_CRAFT_DATASOURCE` stays as a dev seam but now adds one ephemeral datasource to the list, never written to disk, with its password held as Until restart. Without it the list starts empty and the Database pane shows "No data sources. New Data Source (⌘N)". Decision 018 gains this as an amendment                                                                                                            |

### Consequences worth naming

**This changes the plugin contract.** `API_VERSION` 0.2.0 → 0.3.0: manifests gain `connection`,
`connect` takes `{ readOnly }`, sessions report `serverVersion`. All three built-ins and the contract
suite move together.

**This crosses the fence.** New bridge methods for the list and connect; `engine.exited` and
`datasources.changed` broadcasts; the engine boot gains `mode` and `readOnly`. The engine port
protocol itself is unchanged.

**This is a behaviour change.** `bun run desktop` without the variable no longer opens scratch
SQLite; it opens an empty list. Smoke tests seed datasources through the harness instead.

**This default was chosen without asking.** New secrets default to Forever when encryption is
available, as in DataGrip; otherwise to Until restart.

---

## Phase 0 — plugin-api and the plugins

- `manifest.ts`: `connection: { fields: ConnectionField[] }` with the kinds from decision 019.
- `plugin.ts`: `ConnectOptions { readOnly: boolean }`, `Session.serverVersion`.
- `testing/index.ts`: manifest/schema agreement cases; `givenReadOnly_whenInsert_thenStatementFailed`
  (skipped when the fixture provides no write statement); `serverVersion` non-empty.
- Each plugin: fields in its manifest (Postgres host/port/database/user/password/sslMode; MySQL
  host/port/database/user/password/ssl; SQLite path as `file`), read-only enforcement, version
  query (`SHOW server_version`, `SELECT VERSION()`, `sqlite_version()`).

## Phase 1 — main: store, secrets, hosts, probe

| File                  | Responsibility                                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `main/datasources.ts` | load, migrate, validate, save atomically; ids; folder paths. Pure over an injected fs, so it is unit-tested without Electron             |
| `main/secrets.ts`     | the three save modes over an injected cipher (`safeStorage` in the app, a fake in tests); refuses Forever when encryption is unavailable |
| `main/plugins.ts`     | manifest discovery for the dialog; unavailable plugins listed with their reason                                                          |
| `main/hosts.ts`       | keyed by datasource id; boot carries decrypted config and `readOnly`; probe mode; `engine.exited` broadcast; kill on last port           |
| `main/ipc.ts`         | the invoke channels and broadcasts, each payload Zod-parsed                                                                              |

## Phase 2 — renderer

- `state/datasources.ts`, consoles keyed by datasource, per-datasource port in `engine/client.ts`.
- `panes/DatabasePane.tsx`: folder tree, statuses, context menu built from actions, empty state.
- `dialogs/DataSources.tsx`: list + form generated from `connection.fields`, Test Connection,
  secret placeholders and save modes; `dialogs/SecretPrompt.tsx` for Never.
- Tab label, colour tint, status bar showing the active console's datasource and server version.

## Phase 3 — Fixtures, tests, docs

Fixture schema: unchanged; read-only tests reuse `type_probe` with an idempotent `UPDATE`
(Deviation 5).

New cases:

`givenManifestFields_whenComparedWithConnectionSchema_thenAgree`,
`givenPasswordFieldNotSecret_whenContractRuns_thenFails`,
`givenReadOnlySession_whenInsert_thenStatementFailed`,
`givenSession_whenConnected_thenServerVersionNonEmpty`,
`givenDatasourcesFileV1_whenLoaded_thenRoundTrips`,
`givenCorruptDatasourcesFile_whenLoaded_thenBackedUpAndEmptyListWithWarning`,
`givenSaveWrite_whenProcessDiesMidWrite_thenPreviousFileIntact`,
`givenForeverSecret_whenSaved_thenDatasourcesJsonHasNoSecretValue`,
`givenEncryptionUnavailable_whenSavingForever_thenRefusedWithReason`,
`givenNeverSecret_whenConnecting_thenNeedsSecretsReturned`,
`givenBlankSecretOnEdit_whenSaved_thenStoredSecretKept`,
`givenFolderPaths_whenTreeBuilt_thenNestsAndSortsFoldersFirst`,
`givenProbeHangs_whenTimeoutElapses_thenProbeKilledAndTimeoutError`,
`givenLastPortClosed_whenEngineIdle_thenEngineExits`,
`givenTwoDatasources_whenConsolesRun_thenResultsStaySeparate`,
`givenDatasourceDeleted_whenItHadConsoles_thenConsolesClosed`.

Harness: `seedDatasources(profileDir, datasources, secrets?)` writes `datasources.json` into the
fresh profile; secrets seeded as Until restart through `TABLE_CRAFT_DATASOURCE`, or typed through
the dialog. Launch adds `--use-mock-keychain` on macOS.

Docs: `docs/design/specification.md` gains "Datasources and secrets" (file formats, IPC channels,
save modes); decision 018 gains the amendment; `AGENTS.md` updates the `desktop` command.

Every phase ends with `bun run typecheck` and `bun run test` green; phases 0 and 1 also run
`bun run test:db`.

---

## Live test

Docker Postgres and MySQL from `test:db`, a temp SQLite file, 1200×800 window, PNGs in
`docs/evidence/004/`.

Run with `TABLE_CRAFT_EVIDENCE_DIR=docs/evidence/004 bun run test:smoke:db`; the rows are the eleven
scenarios of `test/e2e/datasources.smoke.test.ts` (rows 2 and 3 are one scenario). Each launch gets
a fresh profile seeded with `seedDatasources`, `--use-mock-keychain` on macOS, and a 1200×800
content size (asserted).

| #   | Scenario                                                                                                                   | Database        | Result                                                                                                                                                                                                                                                             | Evidence                     |
| --- | -------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| 1   | Fresh profile shows the empty Database pane and its New Data Source hint                                                   | —               | Pass. "No data sources." with a `New Data Source (⌘N)` button, no tabs, the editor says to add a data source                                                                                                                                                       | `empty-state.png`            |
| 2   | New Data Source → PostgreSQL: the form shows the manifest's fields, secret save mode, Options                              | postgres        | Pass. Name, Folder, Comment; Host, Port, Database, User, Password from the manifest; SSL mode under Advanced; Read-only and Colour under Options; Save password defaults to Forever (asserted)                                                                     | `new-datasource-form.png`    |
| 3   | Test Connection succeeds and shows the server version and time                                                             | postgres        | Pass. "Succeeded · PostgreSQL 17.11 · 23 ms"                                                                                                                                                                                                                       | `test-connection-ok.png`     |
| 4   | Test Connection with a wrong password shows the error and hint in the dialog                                               | mysql           | Pass after a fix. "Could not connect: Access denied for user…" with the hint; the first capture cut the line off before the hint (Deviation 9)                                                                                                                     | `test-connection-failed.png` |
| 5   | Three datasources saved into folders `Local` and `Docker/Main`, all connected, tree nested                                 | all             | Pass. Docker ▸ Main ▸ mysql, pg, then Local ▸ sqlite (folders first, by name, levels asserted), each with its colour swatch and "connected"; status bar "pg · connected · PostgreSQL 17.11"                                                                        | `folders-connected.png`      |
| 6   | Relaunch on the same profile: list restored, `datasources.json` contains no password (asserted), connects without retyping | postgres        | Pass. `datasources.json` has no `password` key and `secretModes.password` is `forever`; `secrets.json` holds no plaintext; after relaunch the console opens without a prompt and `SELECT current_user` returns `table_craft`                                       | `relaunch-restored.png`      |
| 7   | Read-only datasource with a red colour: tab and border tinted, `INSERT` fails with the database's read-only error          | postgres        | Pass after a fix. Red tab, red console border, lock icons; "cannot execute INSERT in a read-only transaction", now with a read-only hint instead of "Fix the statement" (Deviation 10)                                                                             | `read-only-red.png`          |
| 8   | Save mode Never: connect prompts for the password, then works; a second connect after disconnect prompts again             | mysql           | Pass. "Connect to mysql" asks for the password, `SELECT 1` runs; after ⌘F2 and Connect it asks again                                                                                                                                                               | `secret-prompt.png`          |
| 9   | Consoles on Postgres and MySQL side by side keep separate results; status bar follows the active tab                       | postgres, mysql | Pass. `console [pg]` and `console [mysql]` keep their own grids; the status bar switches between "pg · connected · PostgreSQL 17.11" and the MySQL one; two engine processes (asserted from main)                                                                  | `two-datasources.png`        |
| 10  | Disconnect (⌘F2): node shows disconnected, the engine process is gone (asserted from main)                                 | postgres        | Pass. Engine processes 1 → 0 from `app.getAppMetrics()`; the node reads disconnected and the console "Disconnected; Run reconnects."                                                                                                                               | `disconnected.png`           |
| 11  | Kill the engine process: node shows "failed: engine exited", Connect brings it back                                        | mysql           | Pass after a fix. SIGKILL from the test; node "mysql, failed: engine exited", console "Engine exited (code …)"; Connect reconnects without a prompt (Until restart) and `SELECT 1` runs. The first capture also said "Disconnected; Run reconnects." (Deviation 8) | `engine-crashed.png`         |
| 12  | Delete a datasource: confirmation, its consoles close, it is gone after relaunch                                           | sqlite          | Pass after a fix. "Delete "sqlite"? Its 2 open consoles will close."; both tabs close, the empty state returns and stays after relaunch. The first prompt also promised to remove a saved password SQLite never had (Deviation 11)                                 | `deleted.png`                |

Bugs found here are fixed with a regression test each, listed under Deviations.

---

## Deviations taken while implementing

1. **Disconnect goes through main, and Run reconnects (decision 021).** Decision 10 had the engine
   exit only when its last port closed. Main now also posts `engine.shutdown` and kills after
   `SHUTDOWN_GRACE_MS = 3_000`, so a leaked port cannot keep an engine alive, and `engine.exited`
   carries `clean`, because a killed and a crashed engine both exit non-zero. `Run` on a
   disconnected or failed console connects again (prompting for a Never secret) instead of the
   console going dead; the MySQL wrong-password smoke scenarios of plans 002 and 003 now expect
   `Run` enabled and check `Disconnect` greyed instead.
2. **`TABLE_CRAFT_DATASOURCE` without a value means no datasource,** not in-memory SQLite (decision
   018's amendment). The ephemeral datasource is named by its `id`, listed first, read/write, and
   not editable; the app opens a console on it at launch, which keeps every pre-004 smoke suite
   unchanged apart from labels (`console [scratch]`, `scratch · connected · SQLite 3.x`). The
   harness passes the scratch SQLite datasource itself; `launchApp(null)` launches with none.
3. **The harness cannot seed secrets.** `seedDatasources(profileDir, datasources)` has no `secrets`
   argument: a Forever secret is `safeStorage` ciphertext only the launched app can produce, and
   Until restart lives in its memory. Seeded datasources use Until restart and the scenario answers
   the prompt, or the scenario types the password into the dialog (row 6).
4. **The MySQL field stays `sslMode`,** not `ssl`. The existing `connectionSchema` already used
   `sslMode`, as PostgreSQL's does; renaming would break configs for no gain.
5. **The read-only contract case writes with an idempotent `UPDATE`,** not an `INSERT`:
   `statements.write` (`TYPE_PROBE_WRITE`, `UPDATE type_probe SET small_int = small_int WHERE id = 1`)
   leaves the shared fixture as it was, so the contract can run it writable first (proving the
   statement is valid) and then read-only. `ContractFixture` also gained a required `manifest`, and
   `connectionFormProblems(manifest, schema)` is exported for the manifest tests.
6. **Main reads manifests through a new `discoverPlugins(roots)` in core,** which `loadPlugins` now
   builds on. A manifest written for an older `apiVersion` that fails today's schema (no
   `connection`) reports the version mismatch rather than the missing field.
7. **Shortcuts can be scoped to a focus region.** `Mod+N`, `Mod+D` and `Delete` would otherwise steal
   keys from the SQL console, so `Action.shortcutRegion` limits them to the Database tool window and
   the keymap passes them through elsewhere (`givenShortcutScopedToDatabasePane_whenPressedInEditor_
thenPassesThroughAndRunsInPane`). The datasource actions target the tree selection when the
   Database window has focus, else the active console's datasource. `datasource.new` has no menu
   accelerator, since `⌘N` is scoped.
8. **Live-test bug: a crashed engine's console said both "Disconnected; Run reconnects." and
   "Engine exited".** `consoles.detach` now marks the console `failed` when the exit carries an
   error and `disconnected` only for a clean stop
   (`givenEngineCrashed_whenExitArrives_thenFailedEngineExitedConsolesFailedAndRunReconnects`).
9. **Live-test bug: Test Connection's failure ran off the dialog's footer** and hid the hint. It now
   wraps to two lines with the full text as a tooltip; row 4 asserts the hint is part of the result.
10. **Live-test bug: a read-only write got the generic "Fix the statement" hint.** The engine now
    answers a failed statement on a read-only datasource with a hint naming Read-only
    (`givenReadOnlyDatasource_whenWriting_thenStatementFailedWithReadOnlyHint`).
11. **Live-test bug: deleting a datasource without secrets promised to remove its saved password.**
    The sentence now appears only when main holds a secret for it; row 12 asserts it is absent.
12. **Live-test bug: evidence was 1200×768.** The window size includes the title bar; the suite sets
    the content size to 1200×800 and row 1 asserts it (`contentSize` in the harness).
13. **Evidence is captured per plan.** `captureWindow` became `evidenceFor("NNN")`, which writes only
    when `TABLE_CRAFT_EVIDENCE_DIR` ends in that plan's number, so regenerating plan 004's evidence
    does not overwrite plans 002 and 003's screenshots with today's UI.
14. **Colours are named tokens** (`red`, `orange`, `yellow`, `green`, `blue`, `violet`), stored by
    name in `datasources.json`, so a theme can restyle them (`design-system.md`, Datasource colours).
    The Data Sources dialog's size and list width are density tokens too.
15. **Saving a connected datasource does not restart its engine;** the new config applies on the
    next connect (decision 021). Deleting one stops its engine and clears its secrets.
16. **Two renderer-only dialogs were added beside the plan's two:** a small `Modal` (confirm, text
    input, notice) for Delete, New Folder and Move to Folder, since Electron's native dialogs would
    put main in the command path.

---

## Out of scope

- Schemas, tables and the rest of the tree under a datasource: plan 005.
- Console text persistence and autosave: plan 006.
- SSH tunnels and SSL certificate files beyond the plugins' `sslMode`: v1.1.
- Drag and drop between folders: Move to Folder covers it.
- Importing or exporting datasource definitions: decision 010 defers it.
- Keep-alive, startup scripts, time zone and introspection options from DataGrip's Advanced tab.
