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
`API_VERSION` is `0.1.0`; while it is `0.x` the contract is unstable and every minor is a break.

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

| Capability | Promises                             | Contract cases                                                              |
| ---------- | ------------------------------------ | --------------------------------------------------------------------------- |
| `sql`      | `Session.execute` runs one statement | select literals, statement without rows, rows affected, invalid SQL rejects |

`runPluginContract(plugin, fixture)` from `@table-craft/plugin-api/testing` registers the cases for
each declared capability (decision 013).

### DatasourcePlugin and Session

```ts
interface DatasourcePlugin {
  readonly id: string;
  readonly capabilities: readonly Capability[];
  readonly connectionSchema: z.ZodType; // core parses the config with it before connect
  connect(config: unknown): Promise<Session>;
}

interface Session {
  execute(sql: string): Promise<ExecuteResult>; // rejects on a failed statement
  close(): Promise<void>;
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

`toWireValue` converts the JavaScript values drivers return.

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

### Renderer to engine (MessagePort)

A request is `{ id, type, ...params }`; the engine answers `{ id, type, result }` with the same
`id` and `type`, or `engine.error`. Requests are parsed before routing. Sessions and result
handles belong to the port that created them and are released when it closes.

| Request             | Params                      | Result                                                                |
| ------------------- | --------------------------- | --------------------------------------------------------------------- |
| `session.open`      | none                        | `{ sessionId }`, a session on the engine's datasource                 |
| `statement.execute` | `sessionId`, `sql`          | `{ handle, columns, rowCount, truncated, rowsAffected, firstWindow }` |
| `result.window`     | `handle`, `offset`, `limit` | `{ offset, rows }`, at most `RESULT_WINDOW_ROWS` rows                 |
| `result.release`    | `handle`                    | `null`; releasing twice is not an error                               |

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
| `statementFailed`   | The database rejected the statement; the message is the driver's     |
| `invalidRequest`    | The request did not parse                                            |
| `internal`          | Anything else; a bug                                                 |

## Storage

Decision 010.
