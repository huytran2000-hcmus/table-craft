# table-craft specification

A desktop database IDE modelled on JetBrains DataGrip, built with Electron, TypeScript and Bun.
This document describes what the app does; `docs/decisions/` records why.

## Scope

v1 is listed in decision 014. In short: PostgreSQL, MySQL and SQLite through built-in runtime
plugins; connections with encrypted secrets; a database explorer; SQL consoles with autocomplete
and auto or manual commit; a virtualized result grid with export; a table data editor; DDL;
query history; EXPLAIN; configurable themes, fonts and density.

## Processes

Main, one engine per connected datasource, and a sandboxed renderer that talks to each engine over
its own MessagePort (decision 002).

## Plugin contract

A plugin is a directory with `table-craft-plugin.json` and an ESM entry exporting a
`DatasourcePlugin` (decisions 005 to 008). The contract lives in `@table-craft/plugin-api`.
`API_VERSION` is `0.3.0`; while it is `0.x` the contract is unstable and every minor is a break.

### Discovery

The engine loads plugins from `<app>/resources/plugins/*` and then `<userData>/plugins/*`. A
built-in plugin is built into the first root and goes through the same loader as a user plugin.
Each directory ends as `loaded` or `unavailable` with a reason; nothing a plugin does stops the app.

| Failure                                                                       | Reason names        |
| ----------------------------------------------------------------------------- | ------------------- |
| No `table-craft-plugin.json` or unreadable JSON                               | the file            |
| Manifest fails the schema                                                     | every failing field |
| An earlier directory already claimed the id                                   | both directories    |
| `apiVersion` not compatible with the host                                     | both versions       |
| `entry` resolves outside the plugin directory                                 | the entry           |
| The entry throws on import, or its default export is not a `DatasourcePlugin` | the error           |
| The export's `id` or `capabilities` differ from the manifest                  | both values         |

### Manifest

| Field          | Type                | Meaning                                                                                 |
| -------------- | ------------------- | --------------------------------------------------------------------------------------- |
| `id`           | `^[a-z][a-z0-9-]*$` | Unique across both roots; datasources refer to it                                       |
| `name`         | string              | Shown before the entry is ever imported                                                 |
| `version`      | semver              | The plugin's own version                                                                |
| `apiVersion`   | semver              | The `API_VERSION` it was built against; caret-compatible, so `0.x` needs the same minor |
| `entry`        | relative path       | The ESM module, inside the directory                                                    |
| `capabilities` | `Capability[]`      | Must equal the export's                                                                 |
| `highlight`    | string              | The highlighter the console uses (decision 008)                                         |
| `connection`   | `{ fields }`        | The connection form, at least one field (decision 019)                                  |

No other field is accepted. Main reads manifests without importing plugin code, so the Data Sources
dialog lists every plugin, an unavailable one with its reason. A connection field is:

| Field         | Type                                                       | Meaning                                                     |
| ------------- | ---------------------------------------------------------- | ----------------------------------------------------------- |
| `key`         | camelCase                                                  | The `connectionSchema` key it fills; unique                 |
| `label`       | string                                                     | Shown beside the input                                      |
| `kind`        | `text`, `number`, `password`, `file`, `select`, `checkbox` | The input; `file` adds Browse…, `select` needs `options`    |
| `default`     | string, number or boolean                                  | Optional; prefilled in a new datasource                     |
| `required`    | boolean                                                    | Optional; the dialog refuses to save it blank               |
| `placeholder` | string                                                     | Optional                                                    |
| `options`     | `{ value, label }[]`                                       | For `select`                                                |
| `group`       | `general` or `advanced`                                    | Optional, `general` by default; Advanced is its own section |
| `secret`      | boolean                                                    | Kept by main per decision 020; required for `password`      |

### Capabilities

| Capability | Promises                                                       | Contract cases                                                                                                                                                                        |
| ---------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sql`      | `Session.execute` runs one statement                           | select literals, statement without rows, rows affected, invalid SQL rejects `statementFailed`, session usable after a failure, `type_probe` cells, unshifted timestamps, early return |
| `cancel`   | `Session.cancel` stops the running statement from another call | idle cancel is a no-op, a sleeping statement rejects `cancelled` well before it ends, the session runs the next statement                                                             |

Every plugin, whatever it declares, is checked for a valid schema; for its manifest's connection
fields agreeing with `connectionSchema` (each field a key the schema accepts, every required key
filled by a field, a `password` field marked `secret`); for a non-empty `serverVersion`; when the
fixture gives a `wrongPasswordConfig`, for `connect` rejecting `connectionFailed`; and, when it
gives `statements.write`, for a read-only session rejecting that write with `statementFailed` and
staying usable.

`runPluginContract(plugin, fixture)` from `@table-craft/plugin-api/testing` registers the cases for
each declared capability (decision 013). The fixture carries what the suite cannot write portably:

| Field                 | Meaning                                                                                |
| --------------------- | -------------------------------------------------------------------------------------- |
| `manifest`            | The plugin's parsed `table-craft-plugin.json`                                          |
| `config`              | A config for a database seeded from `test/db/schema/<dialect>.sql`                     |
| `wrongPasswordConfig` | Optional; the same database with a password it refuses                                 |
| `statements.sleep(s)` | Optional; a statement that sleeps `s` seconds, required to exercise `cancel`           |
| `statements.write`    | Optional; an idempotent write (`TYPE_PROBE_WRITE`) for the read-only case              |
| `typeProbe.expected`  | The `type_probe` rows as wire values; every dialect shares `test/support/typeProbe.ts` |

### DatasourcePlugin and Session

```ts
interface DatasourcePlugin {
  readonly id: string;
  readonly capabilities: readonly Capability[];
  readonly connectionSchema: z.ZodType; // core parses the config with it before connect
  connect(config: unknown, options: ConnectOptions): Promise<Session>;
}

interface ConnectOptions {
  readonly readOnly: boolean; // a guard against mistakes, not a security boundary (decision 011)
}

interface Session {
  readonly serverVersion: string | null; // "17.4", "8.4.3", "3.53.4"
  execute(sql: string): Promise<ExecuteResult>; // one at a time; rejects with a PluginError
  cancel?(): Promise<void>; // present exactly when `cancel` is declared; no-op when idle
  close(): Promise<void>;
}

class PluginError extends Error {
  readonly code: "cancelled" | "connectionFailed" | "statementFailed";
}

interface ExecuteResult {
  readonly columns: readonly Column[]; // empty for a statement without rows
  readonly rows: AsyncIterable<Row>; // pulled until the fetch cap, then returned
  readonly rowsAffected: number | null;
}

interface Column {
  readonly name: string;
  readonly type: string | null; // the database's declared type, when it has one
}
```

`connect` rejects with `connectionFailed`; `execute` rejects with `statementFailed`, or with
`cancelled` when `cancel` stopped it. Each bundled plugin carries its own copy of the plugin API,
so the host recognises a `PluginError` with `isPluginError` (by name and code), not `instanceof`.
`cancel` reaches the database on a short-lived second connection (`pg_cancel_backend`,
`KILL QUERY`). Returning the rows iterator early closes the cursor or stream and leaves the session
usable. A read-only session is set up by the plugin as it connects: PostgreSQL
`SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`, MySQL `SET SESSION TRANSACTION READ ONLY`,
SQLite `PRAGMA query_only = ON`.

### Wire values

A cell is a `WireValue`: what crosses a MessagePort without loss or surprise (decision 009).

| Value                            | Shape                                                               |
| -------------------------------- | ------------------------------------------------------------------- |
| SQL `NULL`                       | `null`                                                              |
| boolean, safe-range number, text | the JSON primitive                                                  |
| integer outside the safe range   | `{ kind: "bigint", value: "<decimal>" }`                            |
| binary                           | `{ kind: "bytes", preview: "<hex of the first 32 bytes>", length }` |
| JSON document                    | `{ kind: "json", text }`                                            |
| date or timestamp                | `{ kind: "date", iso }`                                             |

`toWireValue` converts the JavaScript values drivers return. Which shape a database type takes is
fixed by decision 017, so the same row reads the same on every database:

| Database type                                                   | Crosses as                                                  |
| --------------------------------------------------------------- | ----------------------------------------------------------- |
| `date`, `time`, `timestamp`, `timestamptz`, `DATETIME`          | the database's own text; no `Date`, so no time-zone shift   |
| `numeric`, `DECIMAL`                                            | the database's text                                         |
| 64-bit integer                                                  | a number when safe, else the `bigint` tag (`toWireInteger`) |
| `boolean`, MySQL `TINYINT(1)`, SQLite column declared `BOOLEAN` | `true` / `false`                                            |
| `json`, `jsonb`, MySQL `JSON`, SQLite column declared `JSON`    | the `json` tag with the database's text                     |
| `bytea`, `BLOB`, `BINARY`, `VARBINARY`                          | the `bytes` tag                                             |

The `date` tag stays for plugins whose driver only hands back a `Date`.

## Protocol

Every message is typed in `packages/desktop/src/engine/protocol.ts`, the only module engine and
renderer share. The renderer may not import core or plugin-api, so the wire types and the
constants both sides need are restated there and pinned by `test/desktop/protocol.test.ts`.

### Main to engine (parent port)

| Message           | Payload                                                                                     | When                                     |
| ----------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `engine.boot`     | `mode` (`serve` or `probe`), `datasource { id, pluginId, config, readOnly }`, `pluginRoots` | Once, right after fork                   |
| `engine.port`     | transfers one `MessagePortMain`                                                             | Each time a window connects (serve only) |
| `engine.shutdown` | none                                                                                        | Disconnect or delete (decision 021)      |

`config` carries the datasource's secrets, decrypted by main for this engine alone (decision 020).
A `probe` engine connects once, answers `engine.probed { result }` with
`{ ok: true, pluginName, serverVersion, elapsedMs }` or `{ ok: false, error }`, and exits; main
kills it after `PROBE_TIMEOUT_MS = 15_000` and answers `timedOut`. A `serve` engine lives while any
port to it is open and exits when the last one closes; on `engine.shutdown` it closes its sessions
and exits, and main kills it after `SHUTDOWN_GRACE_MS = 3_000`. Main never sees a request.

### Renderer to engine (MessagePort)

A request is `{ id, type, ...params }`; the engine answers `{ id, type, result }` with the same
`id` and `type`, or `engine.error`. Requests are parsed before routing. Sessions and result
handles belong to the port that created them and are released when it closes.

| Request             | Params                      | Result                                                                |
| ------------------- | --------------------------- | --------------------------------------------------------------------- |
| `session.open`      | none                        | `{ sessionId, pluginName, capabilities, serverVersion }`              |
| `statement.execute` | `sessionId`, `sql`          | `{ handle, columns, rowCount, truncated, rowsAffected, firstWindow }` |
| `statement.cancel`  | `sessionId`                 | `null`; stops the running statement, a no-op when idle                |
| `result.window`     | `handle`, `offset`, `limit` | `{ offset, rows }`, at most `RESULT_WINDOW_ROWS` rows                 |
| `result.release`    | `handle`                    | `null`; releasing twice is not an error                               |
| `session.close`     | `sessionId`                 | `null`; releases the session's handles, then closes it                |

A statement still running when its session closes is answered with `unknownSession`.

| Constant             | Value  | Meaning                                                   |
| -------------------- | ------ | --------------------------------------------------------- |
| `RESULT_WINDOW_ROWS` | 500    | Rows per window; `firstWindow` is the window at offset 0  |
| `RESULT_FETCH_CAP`   | 10 000 | Rows kept per result; beyond it the result is `truncated` |

### engine.error

`{ id, type: "engine.error", error: { code, message, hint } }`. `id` is `null` only when the request
was unreadable. `hint` says what to do next.

| Code                | Raised when                                                          |
| ------------------- | -------------------------------------------------------------------- |
| `unknownPlugin`     | No plugin has the datasource's `pluginId`                            |
| `pluginUnavailable` | The plugin exists but failed to load; the message carries the reason |
| `invalidConfig`     | The datasource config fails the plugin's `connectionSchema`          |
| `unknownSession`    | `sessionId` is not open on this port                                 |
| `unknownHandle`     | The handle was released, or belongs to another port                  |
| `connectionFailed`  | The plugin could not connect; the message is the driver's            |
| `statementFailed`   | The database rejected the statement; the message is the driver's     |
| `cancelled`         | `statement.cancel` stopped the statement                             |
| `timedOut`          | Test Connection got no answer within `PROBE_TIMEOUT_MS`              |
| `invalidRequest`    | The request did not parse, or cancels on a plugin without `cancel`   |
| `internal`          | Anything else; a bug                                                 |

## Shell and actions

One window (decision 010), laid out the way DataGrip is (`datagrip-inventory.md` §1): a left
stripe and the Database tool window, the editor's tabs in the middle, the Services tool window at
the bottom, an empty right stripe, and a status bar. Which tool windows are open and their sizes
persist in the renderer's `localStorage` under `table-craft.layout.v1`; a value that does not parse
falls back to the default layout.

Each console tab belongs to one datasource and owns a session on that datasource's engine; closing
the tab sends `session.close`. The tab reads `console [name]`, and a datasource's colour tints its
tabs and its console's border; a read-only one shows a lock. The Database tool window shows the
datasource list (see Datasources and secrets); Services lists the open consoles as idle, running or
failed with the last statement's duration. The status bar shows the active console's datasource,
or the selected tree node's, as "pg · connected · PostgreSQL 17.4", or the connect error's message,
on the left and a running indicator on the right; later plans add items to its slot list
(`renderer/shell/statusItems.tsx`).

Every command is an action in one registry (decision 015, `renderer/actions/`). Buttons, the
keymap, the palette and the native menu all call `invoke(id, args?)`, which answers `ran`,
`disabled` or `unknown`. An action's `when(context)` decides whether it is enabled from a snapshot
of the stores; a disabled action shows greyed and does not run.

| Action id                    | Title                   | macOS   | Windows / Linux  |
| ---------------------------- | ----------------------- | ------- | ---------------- |
| `console.run`                | Run                     | `⌘↩`    | `Ctrl+Enter`     |
| `console.cancel`             | Cancel                  |         |                  |
| `console.new`                | New Console             | `⇧⌘L`   | `Ctrl+Shift+L`   |
| `tab.close`                  | Close Tab               | `⌘W`    | `Ctrl+W`         |
| `tab.closeOthers`            | Close Other Tabs        |         |                  |
| `tab.closeAll`               | Close All Tabs          |         |                  |
| `tab.next`                   | Select Next Tab         | `⇧⌘]`   | `Ctrl+Shift+]`   |
| `tab.previous`               | Select Previous Tab     | `⇧⌘[`   | `Ctrl+Shift+[`   |
| `toolWindow.database.toggle` | Database                | `⌘1`    | `Ctrl+1`         |
| `toolWindow.services.toggle` | Services                | `⌘8`    | `Ctrl+8`         |
| `toolWindow.hideAll`         | Hide All Tool Windows   | `⇧⌘F12` | `Ctrl+Shift+F12` |
| `focus.editor`               | Back to Editor          | `⎋`     | `Esc`            |
| `palette.findAction`         | Find Action…            | `⇧⌘A`   | `Ctrl+Shift+A`   |
| `palette.searchEverywhere`   | Search Everywhere       | `⇧⇧`    | Double Shift     |
| `datasource.new`             | New Data Source…        | `⌘N` ¹  | `Ctrl+N` ¹       |
| `datasource.properties`      | Data Source Properties… | `⌘;`    | `Ctrl+;`         |
| `datasource.duplicate`       | Duplicate Data Source   | `⌘D` ¹  | `Ctrl+D` ¹       |
| `datasource.delete`          | Delete Data Source      | `⌦` ¹   | `Delete` ¹       |
| `datasource.connect`         | Connect                 |         |                  |
| `datasource.disconnect`      | Disconnect              | `⌘F2`   | `Ctrl+F2`        |
| `datasource.newFolder`       | New Folder…             |         |                  |
| `datasource.moveToFolder`    | Move to Folder…         |         |                  |

¹ Only with focus in the Database tool window (`shortcutRegion`); elsewhere the key reaches the
focused element. The datasource actions act on the selected tree node with focus in the Database
tool window, else on the active console's datasource. `console.new` opens on that datasource too.

Shortcuts are declared as platform-neutral chords (`Mod+Shift+A`, `Shift Shift`) and dispatched by
one capture-phase `keydown` listener on the window. A chord whose action is disabled reaches the
focused element; no two actions share a chord (a unit test checks the registry). While the palette
is open the keymap stands aside. Hide All Tool Windows restores what it hid when pressed again with
nothing open. Back to Editor applies only with focus in a tool window.

Find Action (`⇧⌘A`) and Search Everywhere (`⇧⇧`) are one palette. Search Everywhere has scope tabs,
`All` and `Actions`, fed by `SearchProvider`s (`renderer/palette/providers.ts`); `Tab` moves between
them. Results are ranked by an in-house fuzzy scorer, and with an empty query the most recently
run actions come first.

The native menu is declared in `preload/menu.ts` and built by main: File (New Data Source…, New
Console; Data Source Properties…, Disconnect; Close Tab),
Edit (role), View (Tool Windows ▸ Database, Services; Hide All Tool Windows; Find Action…; Search
Everywhere; Toggle Developer Tools), Window (role, macOS only), Help (Find Action…). An item shows its
action's accelerator with `registerAccelerator: false` and, when clicked, sends the action id to
the renderer on `table-craft:invoke-action`; main never decides whether an action is enabled.

## Datasources and secrets

Main owns the datasource list (decision 010) and every secret (decision 020). The renderer reads
and changes them over `ipcRenderer.invoke`; main stays out of the request path.

### Files

`<userData>/datasources.json`, written atomically (a temporary file, then a rename):

```json
{
  "version": 1,
  "datasources": [
    {
      "id": "0b7c…",
      "name": "pg",
      "pluginId": "postgres",
      "folder": "Docker/Main",
      "color": "blue",
      "readOnly": false,
      "comment": "",
      "config": {
        "host": "localhost",
        "port": 5432,
        "database": "table_craft",
        "user": "table_craft",
        "sslMode": "disable"
      },
      "secretModes": { "password": "forever" }
    }
  ]
}
```

`id` is a UUID. `folder` is a `/`-separated path or `null`. `color` is one of `red`, `orange`,
`yellow`, `green`, `blue`, `violet` or `null`; the values are design tokens. `config` holds only
the manifest's non-secret fields; a secret value is never in this file. An older `version` is
migrated on load. A file that is not JSON, fails the schema, or has an unknown version is renamed to
`datasources.json.corrupt-<epoch ms>`, the list starts empty, and the Database tool window shows
the reason once.

`<userData>/secrets.json` is `{ "version": 1, "secrets": { "<datasource id>": { "<field key>":
"<base64 safeStorage ciphertext>" } } }`, holding Forever secrets only.

### Save modes

| Mode          | Kept                                    | Connect                                       |
| ------------- | --------------------------------------- | --------------------------------------------- |
| Forever       | `safeStorage`-encrypted in secrets.json | uses it; asks when it no longer decrypts      |
| Until restart | main's memory                           | uses it; asks after a restart                 |
| Never         | not kept                                | asks every time; the value goes to the engine |

A new secret defaults to Forever when `safeStorage` can encrypt, else Until restart. When it cannot,
Forever is disabled in the dialog with the reason, and main refuses it; there is no plaintext
fallback. A secret input never shows the stored value: blank keeps it, Clear removes it. Changing a
mode moves the stored value. Deleting a datasource clears its secrets.

### IPC

Each invoke answers `{ ok: true, value }` or `{ ok: false, error: { message, hint } }`, and each
request is parsed with Zod in main.

| Channel (`table-craft:` …) | Request                          | Value                                                         |
| -------------------------- | -------------------------------- | ------------------------------------------------------------- |
| `datasources.list`         | none                             | `{ datasources, warning, encryption: { available, reason } }` |
| `datasources.save`         | `{ datasource, secrets }`        | the saved datasource                                          |
| `datasources.delete`       | `id`                             | `null`; stops its engine and clears its secrets               |
| `datasources.test`         | `{ datasource, secrets }`        | the probe result; stored secrets are merged in main           |
| `plugins.list`             | none                             | `{ id, name, unavailableReason, capabilities, fields }[]`     |
| `engine.connect`           | `datasourceId`, typed `secrets?` | `connected`, `needsSecrets { keys }` or `failed`              |
| `engine.disconnect`        | `datasourceId`                   | `null` once the engine has exited                             |
| `dialog.choose-file`       | `title`                          | a path, or `null`                                             |

A listed datasource carries `storedSecrets` (the keys main can use without asking), never values.
`secrets` in a save or test maps each secret key to `keep`, `set { value }` or `clear`. Main
broadcasts `datasources.changed` with the new list after every save or delete, and
`engine.exited { datasourceId, code, clean }` when an engine ends. On `connected` the port arrives
as `table-craft:engine-port` with the datasource id, relayed by preload as a window message; a
window holds one port per connected datasource.

### Database tool window

Datasources sit in folders, folders first, each level sorted by name. A node shows the plugin
icon, the name, the colour swatch, a lock when read-only, and its state: disconnected,
connecting, connected, failed with the error, or "failed: engine exited". A toolbar carries New
Data Source, Properties, Connect, Disconnect and New Console; each node's context menu carries the
datasource actions. Enter or a double-click opens a console. With no datasources the window shows
"No data sources." and a New Data Source button.

The Data Sources dialog follows DataGrip: the list on the left with add, duplicate and remove; the
form on the right with Name, Folder, Comment, the plugin's General fields, its Advanced fields,
Options (Read-only, Colour) and a save mode beside each secret; Test Connection, then OK, Cancel
and Apply. Test Connection reports "Succeeded · PostgreSQL 17.4 · 38 ms" or the plugin's error and
hint.

### Development seam

`TABLE_CRAFT_DATASOURCE`, JSON `{ id, pluginId, config }`, adds one ephemeral datasource at the top
of the list, named by its id, never written to disk, its secrets kept Until restart, and opens a
console on it at launch. A malformed value stops the app naming the variable (decision 018).

## Storage

Decision 010.
