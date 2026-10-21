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
`API_VERSION` is `0.2.0`; while it is `0.x` the contract is unstable and every minor is a break.

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

No other field is accepted.

### Capabilities

| Capability | Promises                                                       | Contract cases                                                                                                                                                                        |
| ---------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sql`      | `Session.execute` runs one statement                           | select literals, statement without rows, rows affected, invalid SQL rejects `statementFailed`, session usable after a failure, `type_probe` cells, unshifted timestamps, early return |
| `cancel`   | `Session.cancel` stops the running statement from another call | idle cancel is a no-op, a sleeping statement rejects `cancelled` well before it ends, the session runs the next statement                                                             |

Every plugin, whatever it declares, is checked for a valid schema and, when the fixture gives a
`wrongPasswordConfig`, for `connect` rejecting `connectionFailed`.

`runPluginContract(plugin, fixture)` from `@table-craft/plugin-api/testing` registers the cases for
each declared capability (decision 013). The fixture carries what the suite cannot write portably:

| Field                 | Meaning                                                                                |
| --------------------- | -------------------------------------------------------------------------------------- |
| `config`              | A config for a database seeded from `test/db/schema/<dialect>.sql`                     |
| `wrongPasswordConfig` | Optional; the same database with a password it refuses                                 |
| `statements.sleep(s)` | Optional; a statement that sleeps `s` seconds, required to exercise `cancel`           |
| `typeProbe.expected`  | The `type_probe` rows as wire values; every dialect shares `test/support/typeProbe.ts` |

### DatasourcePlugin and Session

```ts
interface DatasourcePlugin {
  readonly id: string;
  readonly capabilities: readonly Capability[];
  readonly connectionSchema: z.ZodType; // core parses the config with it before connect
  connect(config: unknown): Promise<Session>;
}

interface Session {
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
usable.

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

| Message       | Payload                                              | When                               |
| ------------- | ---------------------------------------------------- | ---------------------------------- |
| `engine.boot` | `datasource { id, pluginId, config }`, `pluginRoots` | Once, right after fork             |
| `engine.port` | transfers one `MessagePortMain`                      | Each time a window asks to connect |

Main forks one engine per datasource and hands the other end of each port to the window that asked
(`table-craft:connect-engine` over IPC, `table-craft:engine-port` back, relayed by preload as a
window message). It never sees a request.

Until connections exist (plan 004), the one datasource comes from `TABLE_CRAFT_DATASOURCE`, JSON
`{ id, pluginId, config }`; unset or blank means in-memory SQLite, and a malformed value stops the
app naming the variable. It is a development and test seam (decision 018).

### Renderer to engine (MessagePort)

A request is `{ id, type, ...params }`; the engine answers `{ id, type, result }` with the same
`id` and `type`, or `engine.error`. Requests are parsed before routing. Sessions and result
handles belong to the port that created them and are released when it closes.

| Request             | Params                      | Result                                                                |
| ------------------- | --------------------------- | --------------------------------------------------------------------- |
| `session.open`      | none                        | `{ sessionId, pluginName, capabilities }` on the engine's datasource  |
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
| `invalidRequest`    | The request did not parse, or cancels on a plugin without `cancel`   |
| `internal`          | Anything else; a bug                                                 |

## Shell and actions

One window (decision 010), laid out the way DataGrip is (`datagrip-inventory.md` §1): a left
stripe and the Database tool window, the editor's tabs in the middle, the Services tool window at
the bottom, an empty right stripe, and a status bar. Which tool windows are open and their sizes
persist in the renderer's `localStorage` under `table-craft.layout.v1`; a value that does not parse
falls back to the default layout.

Each console tab owns an engine session; closing the tab sends `session.close`. The Database tool
window shows the datasource as one node with its plugin name and connection state; Services lists
the open consoles as idle, running or failed with the last statement's duration. The status bar
shows "PostgreSQL · connected", or the connect error's message, on the left and a running
indicator on the right; later plans add items to its slot list (`renderer/shell/statusItems.tsx`).

Every command is an action in one registry (decision 015, `renderer/actions/`). Buttons, the
keymap, the palette and the native menu all call `invoke(id, args?)`, which answers `ran`,
`disabled` or `unknown`. An action's `when(context)` decides whether it is enabled from a snapshot
of the stores; a disabled action shows greyed and does not run.

| Action id                    | Title                 | macOS   | Windows / Linux  |
| ---------------------------- | --------------------- | ------- | ---------------- |
| `console.run`                | Run                   | `⌘↩`    | `Ctrl+Enter`     |
| `console.cancel`             | Cancel                |         |                  |
| `console.new`                | New Console           | `⇧⌘L`   | `Ctrl+Shift+L`   |
| `tab.close`                  | Close Tab             | `⌘W`    | `Ctrl+W`         |
| `tab.closeOthers`            | Close Other Tabs      |         |                  |
| `tab.closeAll`               | Close All Tabs        |         |                  |
| `tab.next`                   | Select Next Tab       | `⇧⌘]`   | `Ctrl+Shift+]`   |
| `tab.previous`               | Select Previous Tab   | `⇧⌘[`   | `Ctrl+Shift+[`   |
| `toolWindow.database.toggle` | Database              | `⌘1`    | `Ctrl+1`         |
| `toolWindow.services.toggle` | Services              | `⌘8`    | `Ctrl+8`         |
| `toolWindow.hideAll`         | Hide All Tool Windows | `⇧⌘F12` | `Ctrl+Shift+F12` |
| `focus.editor`               | Back to Editor        | `⎋`     | `Esc`            |
| `palette.findAction`         | Find Action…          | `⇧⌘A`   | `Ctrl+Shift+A`   |
| `palette.searchEverywhere`   | Search Everywhere     | `⇧⇧`    | Double Shift     |

Shortcuts are declared as platform-neutral chords (`Mod+Shift+A`, `Shift Shift`) and dispatched by
one capture-phase `keydown` listener on the window. A chord whose action is disabled reaches the
focused element; no two actions share a chord (a unit test checks the registry). While the palette
is open the keymap stands aside. Hide All Tool Windows restores what it hid when pressed again with
nothing open. Back to Editor applies only with focus in a tool window.

Find Action (`⇧⌘A`) and Search Everywhere (`⇧⇧`) are one palette. Search Everywhere has scope tabs,
`All` and `Actions`, fed by `SearchProvider`s (`renderer/palette/providers.ts`); `Tab` moves between
them. Results are ranked by an in-house fuzzy scorer, and with an empty query the most recently
run actions come first.

The native menu is declared in `preload/menu.ts` and built by main: File (New Console, Close Tab),
Edit (role), View (Tool Windows ▸ Database, Services; Hide All Tool Windows; Find Action…; Search
Everywhere; Toggle Developer Tools), Window (role, macOS only), Help (Find Action…). An item shows its
action's accelerator with `registerAccelerator: false` and, when clicked, sends the action id to
the renderer on `table-craft:invoke-action`; main never decides whether an action is enabled.

## Storage

Decision 010.
