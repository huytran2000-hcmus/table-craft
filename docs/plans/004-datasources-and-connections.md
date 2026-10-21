# Plan: Manage datasources and connect to many at once

Status: not started

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

Fixture schema: unchanged; read-only tests reuse `type_probe` with an `INSERT`.

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

| #   | Scenario                                                                                                                   | Database        | Result | Evidence                     |
| --- | -------------------------------------------------------------------------------------------------------------------------- | --------------- | ------ | ---------------------------- |
| 1   | Fresh profile shows the empty Database pane and its New Data Source hint                                                   | —               |        | `empty-state.png`            |
| 2   | New Data Source → PostgreSQL: the form shows the manifest's fields, secret save mode, Options                              | postgres        |        | `new-datasource-form.png`    |
| 3   | Test Connection succeeds and shows the server version and time                                                             | postgres        |        | `test-connection-ok.png`     |
| 4   | Test Connection with a wrong password shows the error and hint in the dialog                                               | mysql           |        | `test-connection-failed.png` |
| 5   | Three datasources saved into folders `Local` and `Docker/Main`, all connected, tree nested                                 | all             |        | `folders-connected.png`      |
| 6   | Relaunch on the same profile: list restored, `datasources.json` contains no password (asserted), connects without retyping | postgres        |        | `relaunch-restored.png`      |
| 7   | Read-only datasource with a red colour: tab and border tinted, `INSERT` fails with the database's read-only error          | postgres        |        | `read-only-red.png`          |
| 8   | Save mode Never: connect prompts for the password, then works; a second connect after disconnect prompts again             | mysql           |        | `secret-prompt.png`          |
| 9   | Consoles on Postgres and MySQL side by side keep separate results; status bar follows the active tab                       | postgres, mysql |        | `two-datasources.png`        |
| 10  | Disconnect (⌘F2): node shows disconnected, the engine process is gone (asserted from main)                                 | postgres        |        | `disconnected.png`           |
| 11  | Kill the engine process: node shows "failed: engine exited", Connect brings it back                                        | mysql           |        | `engine-crashed.png`         |
| 12  | Delete a datasource: confirmation, its consoles close, it is gone after relaunch                                           | sqlite          |        | `deleted.png`                |

Bugs found here are fixed with a regression test each, listed under Deviations.

---

## Deviations taken while implementing

---

## Out of scope

- Schemas, tables and the rest of the tree under a datasource: plan 005.
- Console text persistence and autosave: plan 006.
- SSH tunnels and SSL certificate files beyond the plugins' `sslMode`: v1.1.
- Drag and drop between folders: Move to Folder covers it.
- Importing or exporting datasource definitions: decision 010 defers it.
- Keep-alive, startup scripts, time zone and introspection options from DataGrip's Advanced tab.
