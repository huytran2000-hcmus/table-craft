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
`API_VERSION` is `0.9.0`; while it is `0.x` the contract is unstable and every minor is a break.

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

| Capability     | Promises                                                                        | Contract cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sql`          | `Session.execute` runs one statement; the plugin exports `language`             | select literals, statement without rows, rows affected, invalid SQL rejects `statementFailed`, session usable after a failure, `type_probe` cells, unshifted timestamps, early return; `language` splits the shared and fixture scripts into the expected statements, each of which executes, and classifies kinds and the destructive cases; an awkward identifier quotes and reads back, and each `type_probe` row written as `INSERT` literals into `type_probe_copy` reads back equal |
| `transactions` | `Session.transactions` switches auto and manual commit, commits, rolls back     | manual insert then rollback leaves no row and `open` false, manual insert then commit is visible to a second session only after the commit, auto mode tracks an explicit `BEGIN`, switching to auto while open rejects `statementFailed` and stays open, commit and rollback with nothing open are no-ops                                                                                                                                                                                 |
| `cancel`       | `Session.cancel` stops the running statement from another call                  | idle cancel is a no-op, a sleeping statement rejects `cancelled` well before it ends, the session runs the next statement                                                                                                                                                                                                                                                                                                                                                                 |
| `schemaTree`   | `Session.introspector` lists namespaces, describes one, quotes a qualified name | the current namespace is marked, the fixture's tables and `customer_totals` view are described, `orders` has its foreign key and `orders_placed_at_idx`, `customers` has its primary and unique keys, an unknown namespace rejects `introspectionFailed`, `qualifiedName` quotes an awkward identifier, the session runs statements after introspecting                                                                                                                                   |
| `ddl`          | `Introspector.definition` reads a relation's definition; requires `schemaTree`  | `definition` exists exactly when `ddl` is declared; `orders` has its columns, primary key, `orders_total_nonnegative` check and the foreign key naming `customers`; `customer_totals` has its query; `customers` carries its comment where the dialect has one; an unknown relation rejects `definitionNotFound` naming the path and relation                                                                                                                                             |

Every plugin, whatever it declares, is checked for a valid schema; for its manifest's connection
fields agreeing with `connectionSchema` (each field a key the schema accepts, every required key
filled by a field, a `password` field marked `secret`); for a non-empty `serverVersion`; when the
fixture gives a `wrongPasswordConfig`, for `connect` rejecting `connectionFailed`; and, when it
gives `statements.write`, for a read-only session rejecting that write with `statementFailed` and
staying usable.

`runPluginContract(plugin, fixture)` from `@table-craft/plugin-api/testing` registers the cases for
each declared capability (decision 013). The fixture carries what the suite cannot write portably:

| Field                 | Meaning                                                                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest`            | The plugin's parsed `table-craft-plugin.json`                                                                                                                                                                                                                       |
| `config`              | A config for a database seeded from `test/db/schema/<dialect>.sql`                                                                                                                                                                                                  |
| `wrongPasswordConfig` | Optional; the same database with a password it refuses                                                                                                                                                                                                              |
| `statements.sleep(s)` | Optional; a statement that sleeps `s` seconds, required to exercise `cancel`                                                                                                                                                                                        |
| `statements.write`    | Optional; an idempotent write (`TYPE_PROBE_WRITE`) for the read-only case                                                                                                                                                                                           |
| `typeProbe.expected`  | The `type_probe` rows as wire values; every dialect shares `test/support/typeProbe.ts`                                                                                                                                                                              |
| `catalog`             | Required with `schemaTree`: the fixture's namespace path, an awkward identifier with its expected quoting (`quoted { name, qualified }`), the name of `orders`' check (`ordersCheck`) and `customers`' expected comment (`customersComment`, null without comments) |
| `scripts`             | Optional; dialect scripts with the statements `split` must return (`SplitCase { text, statements }`), added to the shared ones                                                                                                                                      |

### DatasourcePlugin and Session

```ts
interface DatasourcePlugin {
  readonly id: string;
  readonly capabilities: readonly Capability[];
  readonly connectionSchema: z.ZodType; // core parses the config with it before connect
  readonly language?: SqlLanguage; // present exactly when `sql` is declared
  connect(config: unknown, options: ConnectOptions): Promise<Session>;
}

interface SqlLanguage {
  split(text: string): readonly StatementSpan[]; // { from, to, sql }, UTF-16 offsets, empties dropped
  classify(sql: string): StatementClass; // { kind, destructive: reason | null }
  quoteIdentifier(name: string): string; // "x" or `x`, the quote doubled inside
  literal(value: WireValue, columnType: string | null): string; // reads back as the same value
  emptyInsert(qualifiedTable: string): string; // a row of defaults: DEFAULT VALUES or () VALUES ()
  updateDefault(defaultExpression: string | null): string; // SET col = <this>: DEFAULT, or SQLite's expression
  generate(statement: GeneratedStatement, relation: Relation, qualifiedName: string): string; // sqlGenerator
}

type GeneratedStatement = "drop" | "select" | "insert" | "update";

interface ConnectOptions {
  readonly readOnly: boolean; // a guard against mistakes, not a security boundary (decision 011)
}

interface Session {
  readonly serverVersion: string | null; // "17.4", "8.4.3", "3.53.4"
  execute(sql: string): Promise<ExecuteResult>; // one at a time; rejects with a PluginError
  cancel?(): Promise<void>; // present exactly when `cancel` is declared; no-op when idle
  readonly introspector?: Introspector; // present exactly when `schemaTree` is declared
  readonly transactions?: Transactions; // present exactly when `transactions` is declared
  close(): Promise<void>;
}

interface Transactions {
  setMode(mode: "auto" | "manual"): Promise<void>; // to auto rejects `statementFailed` while open
  commit(): Promise<void>; // no-op when nothing is open
  rollback(): Promise<void>;
  readonly mode: "auto" | "manual";
  readonly open: boolean;
}

interface Introspector {
  namespaces(): Promise<readonly Namespace[]>; // sorted by name
  describe(path: readonly string[]): Promise<NamespaceCatalog>; // rejects `introspectionFailed`
  qualifiedName(path: readonly string[], name: string): string; // quoted as the dialect quotes
  definition?(path: readonly string[], name: string): Promise<string>; // present exactly when `ddl` is declared
}

class PluginError extends Error {
  readonly code: "cancelled" | "connectionFailed" | "statementFailed" | "introspectionFailed" | "definitionNotFound";
}

class DefinitionNotFoundError extends PluginError {
  readonly path: readonly string[];
  readonly relation: string;
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

### SQL language and transactions

`@table-craft/plugin-api/sql` offers the tokenizer the built-ins share (decision 023):
`sqlSplitter(options)`, `classifyTokens(sql, options)` and `transactionEffect(sql, options)`, which
answers `begin`, `end` or `null`, and for the copy extractor `quoteIdentifierWith(quote)` and
`sqlLiteral(value, options)`. Each built-in passes its dialect options:

| Plugin     | Options                                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| PostgreSQL | dollar quotes, nested block comments, `BEGIN … END` bodies; `"x"`, `'\x…'::bytea`                                |
| MySQL      | backslash escapes, `DELIMITER`, `#` comments, `BEGIN … END` bodies; `` `x` ``, `X'…'`, backslash-escaped strings |
| SQLite     | `BEGIN … END` bodies; `"x"`, `X'…'`                                                                              |

A span runs from the statement's first token to its last, so comments around it stay out. A
`BEGIN … END` body opens only inside `CREATE TRIGGER`, `FUNCTION`, `PROCEDURE` or `EVENT`, so
`BEGIN;` still starts a transaction. `classify` reads the first keyword (through a `WITH`) into
`read`, `write`, `ddl`, `transaction` or `other`, and names a destructive statement's reason:
`UPDATE without WHERE`, `DELETE without WHERE`, `DELETE without WHERE (LIMIT does not choose the
rows)`, `DROP TABLE` (or whatever is dropped) and `TRUNCATE`. Only a top-level `WHERE` counts.

In manual mode the plugin opens a transaction before the first statement that is not itself a
transaction statement: `BEGIN` on PostgreSQL and SQLite, `SET autocommit = 0` on MySQL. In either
mode `transactionEffect` tracks an explicit `BEGIN`, `START TRANSACTION`, `COMMIT` or `ROLLBACK`,
and on MySQL a DDL statement's implicit commit closes the transaction. Closing a session with a
transaction open rolls it back.

### Catalog

The namespace is the unit of introspection (decision 022). A `Namespace` is
`{ path, name, kind: "database" | "schema", system, current }`:

| Plugin     | Namespaces                                                       | `qualifiedName(path, "orders")` |
| ---------- | ---------------------------------------------------------------- | ------------------------------- |
| PostgreSQL | the connected database `[db]`, then its schemas `[db, schema]`   | `"public"."orders"`             |
| MySQL      | each database as `[db]`, kind `schema`                           | `` `table_craft`.`orders` ``    |
| SQLite     | `main`, `temp` and attached databases as `[name]`, kind `schema` | `"main"."orders"`               |

System namespaces are `pg_catalog`, `information_schema` and `pg_toast`; `information_schema`,
`mysql`, `performance_schema` and `sys`; and SQLite's `temp`. `describe(path)` answers a
`NamespaceCatalog { path, relations, routines, sequences }`. A `Relation` is a table, view or
materialized view with its comment, `columns` (`name`, `position`, `type` as the database writes
it, `nullable`, `default` as database text, `comment`, `autoIncrement`), `primaryKey`,
`uniqueKeys`, `foreignKeys` (`target { path, relation, columns }`, `onDelete`, `onUpdate`) and
`indexes` (`unique`, `primary`). Lists are sorted by name, columns by position. Triggers, checks,
partitions, users and grants are not described; a relation's definition shows them (DDL and SQL
generation). PostgreSQL describes a schema the user lacks
`USAGE` on as `introspectionFailed` ("permission denied for schema …"), since `pg_catalog` itself
would answer. SQLite has no constraint names, so the plugin names keys as DataGrip does
(`orders_pk`, `orders_customers_id_fk`).

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

| Request                 | Params                                                   | Result                                                                                                         |
| ----------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `session.open`          | none                                                     | `{ sessionId, pluginName, capabilities, serverVersion }`                                                       |
| `script.split`          | `text`                                                   | `ClassifiedStatement[]`: `{ from, to, sql, kind, destructive }`                                                |
| `statement.execute`     | `sessionId`, `sql`                                       | `{ handle, columns, typeClasses, rowCount, complete, cursorOpen, rowsAffected, firstWindow, transactionOpen }` |
| `transaction.setMode`   | `sessionId`, `mode`                                      | `{ mode, transactionOpen }`                                                                                    |
| `transaction.commit`    | `sessionId`                                              | `{ mode, transactionOpen }`; a no-op when nothing is open                                                      |
| `transaction.rollback`  | `sessionId`                                              | `{ mode, transactionOpen }`; a no-op when nothing is open                                                      |
| `statement.cancel`      | `sessionId`                                              | `null`; stops the running statement, a no-op when idle                                                         |
| `result.window`         | `handle`, `offset`, `limit`                              | `{ offset, rows }`, at most `RESULT_WINDOW_ROWS` rows                                                          |
| `result.release`        | `handle`                                                 | `null`; releasing twice is not an error                                                                        |
| `result.fetchMore`      | `handle`, `all`                                          | `ResultState { rowCount, complete, cursorOpen }`; one page, or up to `RESULT_FETCH_ALL_CAP`                    |
| `result.stopFetch`      | `handle`                                                 | `ResultState`; stops a running fetch, the cursor stays open                                                    |
| `result.sort`           | `handle`, `keys: { column, direction }[]`                | `ResultState`; windows read through the new order, `[]` restores it                                            |
| `result.extract`        | `handle`, `extractor`, `rows: { from, to }[]`, `columns` | the text, rows in sorted order                                                                                 |
| `result.export`         | `handle`, `extractor`, `path`, `columns`                 | `{ path, rows, bytes, elapsedMs }`; `path` must be absolute                                                    |
| `session.close`         | `sessionId`                                              | `null`; releases the session's handles, then closes it                                                         |
| `catalog.namespaces`    | `refresh?`                                               | `Namespace[]`                                                                                                  |
| `catalog.describe`      | `path`, `refresh?`                                       | `{ catalog, introspectedAt, elapsedMs }`                                                                       |
| `catalog.qualifiedName` | `path`, `name`                                           | the plugin's quoting, e.g. `"public"."orders"`                                                                 |
| `catalog.definition`    | `path`, `name`                                           | the relation's DDL text, read anew each time; needs `ddl`; see DDL and SQL generation                          |
| `sql.generate`          | `path`, `name`, `statement`                              | `create`, `drop`, `select`, `insert` or `update` text for the relation; `create` is `catalog.definition`       |
| `table.query`           | `sessionId`, `path`, `relation`, `where`, `orderBy`      | `TableQuery { statement, sql, editable, columns, foreignKeys, referencing }`; see Table data editor            |
| `table.count`           | `path`, `relation`, `where`                              | the row count, read on a short-lived session of its own                                                        |
| `table.orderBy`         | `terms: { name, direction }[]`                           | the ORDER BY text in the plugin's quoting, e.g. `"qty" DESC, "label"`                                          |
| `table.condition`       | `handle`, `rows`, `columns: { column, name }[]`          | a WHERE condition matching those rows' values, written against `name`                                          |
| `completion.complete`   | `text`, `offset`, `scope?: { path, relation }`           | `{ from, to, items, validFor }`; see Completion and navigation                                                 |
| `navigation.resolve`    | `text`, `offset`                                         | `Declaration` or `null`; see Completion and navigation                                                         |
| `edits.preview`         | `handle`, `edits: RowEdit[]`                             | the statements Submit would run                                                                                |
| `edits.submit`          | `sessionId`, `handle`, `edits: RowEdit[]`                | `{ statements, rowsAffected }`, or `editRejected` after a rollback                                             |

A statement reads its first page and keeps the cursor open; the session's next statement, a
commit, rollback or mode switch, `result.release`, `session.close` and the engine's exit close it
first (decision 025). `result.fetchMore` calls on one handle run one after another; a cursor error
closes it and answers `statementFailed`. `result.export` writes the held rows in sorted order, then
drains the rest of the cursor uncapped, into `<path>.tmp` renamed into place, removed on failure.
A statement still running when its session closes is answered with `unknownSession`.
`script.split` needs no session; it runs the plugin's `language` in the engine, so the renderer
never parses SQL (decision 008). `transactionOpen` is `false` on a plugin without `transactions`,
and `transaction.*` on one answers `invalidRequest`.

The `catalog.*` requests need `schemaTree` and run on one introspection session per engine, opened
on first use and closed with the engine, never on a console's session. The engine caches the
namespace list and each described catalog (`core/catalog/cache.ts`) with when it was introspected
and how long it took; `refresh` asks again, and a second describe of a path in flight joins the
first. The cache dies with the engine, so a disconnect or an engine exit forgets it.

| Constant               | Value   | Meaning                                                       |
| ---------------------- | ------- | ------------------------------------------------------------- |
| `RESULT_WINDOW_ROWS`   | 500     | Rows per window; `firstWindow` is the window at offset 0      |
| `RESULT_PAGE_ROWS`     | 500     | Rows a statement and each Fetch Next Page read (decision 025) |
| `RESULT_FETCH_ALL_CAP` | 100 000 | Rows Fetch All stops at; the cursor closes there              |

### engine.error

`{ id, type: "engine.error", error: { code, message, hint } }`. `id` is `null` only when the request
was unreadable. `hint` says what to do next.

| Code                  | Raised when                                                             |
| --------------------- | ----------------------------------------------------------------------- |
| `unknownPlugin`       | No plugin has the datasource's `pluginId`                               |
| `pluginUnavailable`   | The plugin exists but failed to load; the message carries the reason    |
| `invalidConfig`       | The datasource config fails the plugin's `connectionSchema`             |
| `unknownSession`      | `sessionId` is not open on this port                                    |
| `unknownHandle`       | The handle was released, or belongs to another port                     |
| `connectionFailed`    | The plugin could not connect; the message is the driver's               |
| `statementFailed`     | The database rejected the statement; the message is the driver's        |
| `cancelled`           | `statement.cancel` stopped the statement                                |
| `introspectionFailed` | The database refused to describe a namespace; the hint says Synchronize |
| `definitionNotFound`  | `catalog.definition` named a relation the database no longer has        |
| `timedOut`            | Test Connection got no answer within `PROBE_TIMEOUT_MS`                 |
| `editRejected`        | Submit rolled back; `statementIndex` names the failing statement        |
| `invalidRequest`      | The request did not parse, or asks a plugin for a capability it lacks   |
| `internal`            | Anything else; a bug                                                    |

## Shell and actions

One window (decision 010), laid out the way DataGrip is (`datagrip-inventory.md` §1): a left
stripe and the Database tool window, the editor's tabs in the middle, the Services tool window at
the bottom, an empty right stripe, and a status bar. Which tool windows are open and their sizes
persist in the renderer's `localStorage` under `table-craft.layout.v1`; a value that does not parse
falls back to the default layout.

Each console tab belongs to one datasource and owns a session on that datasource's engine; closing
the tab sends `session.close`. The tab reads `console [name]`, and a datasource's colour tints its
tabs and its console's border; a read-only one shows a lock. The Database tool window shows the
datasource list (see Datasources and secrets); Services is the session tree of the open console and
table tabs with their recent executions (see Query history and Services). The status bar shows the active console's datasource,
or the selected tree node's, as "pg · connected · PostgreSQL 17.4", or the connect error's message,
and the namespace's last synchronization (see Database explorer) on the left, and a running
indicator on the right; later plans add items to its slot list (`renderer/shell/statusItems.tsx`).

Every command is an action in one registry (decision 015, `renderer/actions/`). Buttons, the
keymap, the palette and the native menu all call `invoke(id, args?)`, which answers `ran`,
`disabled` or `unknown`. An action's `when(context)` decides whether it is enabled from a snapshot
of the stores; a disabled action shows greyed and does not run.

| Action id                                | Title                                 | macOS    | Windows / Linux        |
| ---------------------------------------- | ------------------------------------- | -------- | ---------------------- |
| `console.run`                            | Run                                   | `⌘↩`     | `Ctrl+Enter`           |
| `console.runAll`                         | Run All                               | `⇧⌘↩`    | `Ctrl+Shift+Enter`     |
| `console.cancel`                         | Cancel                                |          |                        |
| `console.new`                            | New Console                           | `⇧⌘L`    | `Ctrl+Shift+L`         |
| `transaction.commit`                     | Commit                                | `⌥⇧⌘↩`   | `Ctrl+Alt+Shift+Enter` |
| `transaction.rollback`                   | Rollback                              |          |                        |
| `transaction.toggleMode`                 | Toggle Transaction Mode (Auto/Manual) |          |                        |
| `result.pin`                             | Pin Result Tab                        |          |                        |
| `grid.fetchNextPage`                     | Fetch Next Page                       |          |                        |
| `grid.fetchAll`                          | Fetch All                             |          |                        |
| `grid.cancelFetch`                       | Cancel Fetch                          |          |                        |
| `grid.rerun`                             | Rerun                                 | `⌘R` ²   | `Ctrl+R` ²             |
| `grid.copy`                              | Copy                                  | `⌘C` ²   | `Ctrl+C` ²             |
| `grid.selectAll`                         | Select All Rows                       | `⌘A` ²   | `Ctrl+A` ²             |
| `grid.export`                            | Export Data…                          |          |                        |
| `grid.toggleValuePanel`                  | Value Panel                           | `⇧↵` ²   | `Shift+Enter` ²        |
| `grid.setExtractor`                      | Choose Extractor                      |          |                        |
| `grid.sort`, `grid.clearSort`            | Sort, Clear Sort                      |          |                        |
| `grid.hideColumn`, `grid.showAllColumns` | Hide Column, Show All Columns         |          |                        |
| `grid.copyColumnName`                    | Copy Column Name                      |          |                        |
| `tab.close`                              | Close Tab                             | `⌘W`     | `Ctrl+W`               |
| `tab.closeOthers`                        | Close Other Tabs                      |          |                        |
| `tab.closeAll`                           | Close All Tabs                        |          |                        |
| `tab.next`                               | Select Next Tab                       | `⇧⌘]`    | `Ctrl+Shift+]`         |
| `tab.previous`                           | Select Previous Tab                   | `⇧⌘[`    | `Ctrl+Shift+[`         |
| `toolWindow.database.toggle`             | Database                              | `⌘1`     | `Ctrl+1`               |
| `toolWindow.services.toggle`             | Services                              | `⌘8`     | `Ctrl+8`               |
| `toolWindow.hideAll`                     | Hide All Tool Windows                 | `⇧⌘F12`  | `Ctrl+Shift+F12`       |
| `focus.editor`                           | Back to Editor                        | `⎋`      | `Esc`                  |
| `palette.findAction`                     | Find Action…                          | `⇧⌘A`    | `Ctrl+Shift+A`         |
| `palette.searchEverywhere`               | Search Everywhere                     | `⇧⇧`     | Double Shift           |
| `datasource.new`                         | New Data Source…                      | `⌘N` ¹   | `Ctrl+N` ¹             |
| `datasource.properties`                  | Data Source Properties…               | `⌘;`     | `Ctrl+;`               |
| `datasource.duplicate`                   | Duplicate Data Source                 | `⌘D` ¹   | `Ctrl+D` ¹             |
| `datasource.delete`                      | Delete Data Source                    | `⌦` ¹    | `Delete` ¹             |
| `datasource.connect`                     | Connect                               |          |                        |
| `datasource.disconnect`                  | Disconnect                            | `⌘F2`    | `Ctrl+F2`              |
| `datasource.newFolder`                   | New Folder…                           |          |                        |
| `datasource.moveToFolder`                | Move to Folder…                       |          |                        |
| `database.synchronize`                   | Synchronize                           | `⌥⌘Y`    | `Ctrl+Alt+Y`           |
| `explorer.collapseAll`                   | Collapse All                          | `⌘-` ¹   | `Ctrl+-` ¹             |
| `explorer.toggleSystemSchemas`           | Show System Schemas                   |          |                        |
| `explorer.copyName`                      | Copy Qualified Name                   | `⌥⇧⌘C` ¹ | `Ctrl+Alt+Shift+C` ¹   |
| `explorer.reveal`                        | Select in Database View               |          |                        |
| `history.show`                           | Query History…                        | `⌥⌘E`    | `Ctrl+Alt+E`           |
| `history.clear`                          | Clear Query History…                  |          |                        |
| `console.reopen`                         | Open Closed Console…                  |          |                        |
| `services.cancel`                        | Cancel Running Statement              |          |                        |
| `services.clearExecutions`               | Clear Executions                      |          |                        |
| `services.copySql`                       | Copy Execution SQL                    |          |                        |
| `services.openInConsole`                 | Open Execution in Console             |          |                        |

¹ Only with focus in the Database tool window (`shortcutRegion`); elsewhere the key reaches the
focused element. ² Only with focus in a result grid (region `grid`); in the editor and
the value panel ⌘C and ⌘A stay native. The datasource actions act on the selected tree node with focus in the Database
tool window, else on the active console's datasource. `console.new` opens on that datasource too.

Shortcuts are declared as platform-neutral chords (`Mod+Shift+A`, `Shift Shift`) and dispatched by
one capture-phase `keydown` listener on the window. A chord whose action is disabled reaches the
focused element; no two actions share a chord (a unit test checks the registry). While the palette
is open the keymap stands aside. Hide All Tool Windows restores what it hid when pressed again with
nothing open. Back to Editor applies only with focus in a tool window; `shortcutRegion` may name
several regions. With focus in the SQL editor the keymap also stands aside for the chords CodeMirror
owns, `EDITOR_CHORDS` in `renderer/console/editorKeys.ts` (`⌘Z`, `⇧⌘Z`, `⌘A`, `⌘F`, `⌘/`, `⌘D`,
`Esc`, `⌃Space`); a unit test fails when an action that can fire in the editor takes one of them.

Find Action (`⇧⌘A`) and Search Everywhere (`⇧⇧`) are one palette. Search Everywhere has scope tabs,
`All`, `Actions` and `Tables`, fed by `SearchProvider`s (`renderer/palette/providers.ts`); `Tab` moves between
them. Results are ranked by an in-house fuzzy scorer, and with an empty query the most recently
run actions come first.

The native menu is declared in `preload/menu.ts` and built by main: File (New Data Source…, New
Console; Data Source Properties…, Disconnect, Synchronize; Close Tab),
Edit (role), View (Tool Windows ▸ Database, Services; Hide All Tool Windows; Show System Schemas;
Query History…, Open Closed Console…; Find Action…; Search
Everywhere; Toggle Developer Tools), Window (role, macOS only), Help (Find Action…). An item shows its
action's accelerator with `registerAccelerator: false` and, when clicked, sends the action id to
the renderer on `table-craft:invoke-action`; main never decides whether an action is enabled.

## SQL console

A console is a CodeMirror 6 editor (`renderer/console/Editor.tsx`) above its result tabs. The
plugin's manifest `highlight` picks the `lang-sql` dialect (`postgresql`, `mysql`, `sqlite`, else
standard SQL). It has line numbers, bracket matching, line comments (`⌘/`), search (`⌘F`), multiple
cursors, undo and completion (see Completion and navigation); its colours and font are the editor and syntax tokens, read
as CSS variables (`renderer/console/editorTheme.ts`). The datasource colour tints the editor's
border. The editor's accessible name is `SQL console`.

### Run scopes

The renderer sends the text to `script.split` only when the user runs, and picks the statements
with `renderer/model/statementAt.ts`:

| Run                | Caret or selection                            | Runs                                  |
| ------------------ | --------------------------------------------- | ------------------------------------- |
| `console.run` (⌘↩) | caret inside a statement                      | that statement                        |
|                    | caret in whitespace or a comment after one    | the statement before it               |
|                    | caret before the first statement              | the first statement                   |
|                    | selection touching several statements         | each of them, in order                |
|                    | selection inside one statement, not all of it | the selected text, as one statement   |
| `console.runAll`   | anything                                      | every statement                       |
| either             | no statements                                 | nothing; Output says `Nothing to run` |

The statement about to run flashes in the editor. Statements run one after another on the
console's session; the first error or cancel stops the batch, and Output says how many were
skipped. Before anything runs, every destructive statement in the batch is listed in one dialog
with its reason, Execute or Cancel; Cancel runs nothing and logs `Cancelled; nothing ran.`. Run on
a disconnected console connects first (decision 021).

### Results and Output

Under the editor sit `Output` and one tab per statement that returned rows, `Result 1`,
`Result 2`…, with the SQL as the tooltip; each holds a `ResultGrid` over its own handle. A new run
releases the unpinned result tabs and numbers new ones after the pinned; the pin on a tab
(`result.pin`) keeps it across runs. The last tab a run opens is shown, or `Output` when the run
failed.

Output is a log per console, in memory and capped at `OUTPUT_LIMIT = 500` entries: the time, the
first line of the SQL, then `2 rows retrieved in 38 ms` (`500+ rows retrieved` while the cursor has
more), `1 row affected in 12 ms`, `completed in 4 ms` for statements that are not writes,
`Cancelled`, `50,000 rows exported to /path/a.csv (1.8 MB) in 120 ms`, or the error with its hint.
Commit, Rollback, skipped statements and a session lost with its transaction are logged too. A
statement's error also shows in the toolbar.

### Result grid

Plan 007. `renderer/grid/ResultGrid.tsx` draws a result as DataGrip does: a toolbar, a sticky
header and row-number gutter, virtualized rows, and an optional value panel on the right.

**Paging.** A statement answers with its first `RESULT_PAGE_ROWS` rows and an open cursor
(decision 025). The toolbar reads, left to right: Fetch Next Page, Fetch All, Rerun, Cancel fetch
while a fetch runs, the state label, then the extractor select, Copy, Export Data… and Value Panel.

| Label                               | When                                                           |
| ----------------------------------- | -------------------------------------------------------------- |
| `5,000 rows`                        | Everything was read                                            |
| `500+ rows`                         | The cursor is open; Fetch Next Page and Fetch All are enabled  |
| `500+ rows · fetching stopped`      | Something closed the cursor first; Rerun runs it again         |
| `100,000+ rows · fetch cap reached` | Fetch All stopped at `RESULT_FETCH_ALL_CAP`                    |
| `… · sorted locally`                | Appended while a local sort is on a result not completely read |

**Columns.** The header shows the column name with a type glyph (number, text, date, bool, json,
bytes) from core's `typeClass`; a column the driver did not type takes the class of its first
non-null value. The tooltip is `name: type`. Numbers are right-aligned. A column starts as wide as
its header and the widest value loaded so far, capped at `--spacing-column-max`; dragging the
header's right edge resizes it (at least 40 px) and double-clicking fits it to its loaded values.
The header context menu holds Sort Ascending, Sort Descending, Clear Sort, Hide Column, Show All
Columns and Copy Column Name. Widths, hidden columns and sort belong to the result tab
(`model/columnLayout.ts`) and survive Rerun when the column names are the same.

**Sort.** Clicking a header cycles ascending, descending, none on that column alone; ⌥-click adds
the column as the next key or cycles it in place, and the header shows its arrow and position.
`result.sort` sorts the rows the engine holds through a permutation, comparing by type class:
numbers and decimal text numerically and exactly, booleans false first, everything else by code
point; `NULL` sorts last ascending and first descending. Rows fetched later take their sorted
places.

**Selection and copy.** Click, shift-click, drag, the arrows (shift extends), Page Up/Down,
Home/End select a rectangle; the gutter selects rows, ⌘-click on a header a column, `grid.selectAll`
every fetched row. Copy asks the engine for `result.extract` over the selection's rows and visible
columns in the chosen extractor and writes the clipboard; above `MAX_COPY_ROWS = 100_000` rows
it is disabled with the reason. The extractor is one setting in the layout, default CSV:

| Extractor   | Output                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------- |
| CSV         | Header row, RFC 4180 quoting, `\n` line ends, `NULL` empty                               |
| TSV         | Header row; tab, newline, return and backslash escaped as `\t` `\n` `\r` `\\`            |
| JSON        | An array of objects; `json` cells embedded, bigints and decimals as strings, bytes `0x…` |
| SQL Inserts | `INSERT INTO MY_TABLE (…) VALUES (…);` per row with the plugin's quoting and literals    |
| Markdown    | A pipe table; `\|` escaped, newlines as `<br>`, `NULL` empty                             |

Bytes carry only their 32-byte preview, so a longer value copies clipped (`0x…` with `…`, or a
`/* 32 of 2048 bytes */` comment after the literal).

**Export.** `grid.export` asks main for a path (`dialog.saveFile`, default name
`<result title>.<ext>`), then sends `result.export` with the visible columns; Output logs rows,
size and time.

**Values.** `NULL` reads `<null>` in `text-grid-null` italics, unlike the text `'<null>'`. The
value panel (⇧↵) shows the focused cell: JSON pretty-printed in a read-only editor, text wrapped,
bytes as hex lines with `32 of 2,048 bytes shown`, `NULL` muted.

**Memory.** A tab keeps at most `MAX_LOADED_WINDOWS = 20` windows of `RESULT_WINDOW_ROWS`; loading
another evicts the one furthest from it, and scrolling back fetches it again. When the engine
exits, the tab keeps its windows, shows `Results from a closed connection; rerun to refresh` and
stops fetching; Rerun reconnects (decision 021) and runs the statement again in place.

### Transactions

A console on a plugin with `transactions` shows a `Tx: Auto` / `Tx: Manual` select, Commit and
Rollback (enabled while a transaction is open) and a `transaction open` badge. Every console starts
in auto; the mode is applied when the session opens. Switching to auto, closing the console's tab,
disconnecting its datasource or quitting with a transaction open asks once, listing the consoles,
Commit, Rollback or Cancel. Quitting and closing the window wait for that answer (decision 024).

A successful `ddl` statement re-describes the datasource's cached namespaces when no transaction is
open; in an open transaction it waits for the commit, and a rollback drops it. Dragging a relation,
view or column from the Database tool window into the editor inserts its `catalog.qualifiedName`
at the drop point.

### Console files

A console on a saved datasource autosaves to `<userData>/consoles/<datasourceId>/<name>.sql`,
500 ms after the last edit (`AUTOSAVE_DELAY_MS`), when its tab closes and before the window closes.
A new console takes the first free name of `console`, `console_1`, `console_2`…, counting files and
open tabs. Closing a tab keeps its file unless the text is blank, which deletes it. Deleting a
datasource deletes its console directory; the confirmation says how many files that is. Consoles on
the `TABLE_CRAFT_DATASOURCE` datasource are not saved. A closed console's file comes back through
Open Closed Console… (see Query history and Services), which reopens it under its own name.

The layout remembers the open console tabs (`openConsoles`: datasource id, name, which is active).
At launch they reopen with their text and their datasource disconnected; the first Run connects, so
launch makes no connections.

## Table data editor

Plan 008, decision 026. F4 on a table or view in the Database tool window, double-click or Enter on
its node, Search Everywhere's Tables tab, or `table.open` opens a table tab labelled `orders [pg]`;
opening a table already open activates its tab. Each table tab has an engine session of its own,
closed with the tab. The layout remembers open table tabs (`openTables`: datasource id, path,
relation, which is active); they reopen disconnected and Reload connects.

`table.query` builds `SELECT * FROM <qualifiedName> [WHERE …] [ORDER BY …]` with the two bars'
text verbatim (trimmed, a trailing `;` dropped) and pages like any statement (decision 025). It
answers the executed statement, the SQL, the catalog's columns and foreign keys for the relation,
the foreign keys of described namespaces that reference it, and `editable`:

| `editable`                      | When                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `{ identity: ["id"] }`          | The primary key, else the first unique key whose columns are all `NOT NULL`         |
| `{ readOnly: "<reason>" }`      | A view or materialized view, no such key, a read-only datasource, no `transactions` |
| `{ readOnly: "…out of date…" }` | The result's columns no longer match the cached catalog; Synchronize and Reload     |

A refused WHERE or ORDER BY shows the database's message under the bars, marks the non-blank bar red
and keeps the previous rows. Enter in a bar applies both, Esc reverts both to the applied text. A
header click asks `table.orderBy` for the plugin-quoted clause, writes it into the ORDER BY bar and
reads again; local sort is refused on a table result. Filter by This Value ANDs a
`table.condition` (`= literal`, `IN (…)`, `IS NULL`) into the WHERE bar. Count Rows runs
`SELECT COUNT(*)` with the applied WHERE on a session of its own, so the open cursor survives.

Pending changes live in the renderer (`model/editBuffer.ts`): cell inputs (`text`, `null`,
`default`) per held row, inserted rows after the held rows, and deleted rows. Submit sends them as
`RowEdit[]`; the engine generates literal SQL with the plugin's `language` in the order deletes,
updates, inserts. An UPDATE or DELETE is keyed by the identity columns; an INSERT lists only
non-default columns, and one with none left uses `language.emptyInsert(table)`. Setting a column to
default uses `language.updateDefault(columnDefault)` (`DEFAULT`, or SQLite's default expression).
`edits.submit` closes the table's cursor, runs every statement in one transaction, requires each
UPDATE and DELETE to affect exactly one row, commits and returns to auto; any failure rolls back and
answers `editRejected` naming the statement, and the buffer stays. After a commit the editor reads
the rows again with the same bars. Bytes cells and read-only tables refuse edits.

| Action                  | Chord     | Region             |
| ----------------------- | --------- | ------------------ |
| Open Data               | F4        | Database           |
| Reload                  | ⌘R        | table editor       |
| Edit Cell               | ↵, F2     | grid               |
| Set NULL / Set DEFAULT  | ⌥⌘N / ⌥⌘D | grid               |
| Add Row                 | ⌘N        | table editor, grid |
| Duplicate Row           | ⌘D        | grid               |
| Delete Rows             | ⌘⌫        | grid               |
| Revert Selected         | ⌥⌘Z       | grid               |
| Preview Pending Changes | ⇧⌘P       | table editor, grid |
| Submit                  | ⌘↵        | table editor, grid |
| Apply Value             | ⌘↵        | value panel        |
| Go to Referenced Row    | ⌘B        | grid               |

Table actions apply only while a table tab is active (`Action.tabKind`); the keymap counts two
chords as a clash only when their regions and tab kinds overlap, so ⌘↵ runs in a console and
submits in a table. Inside a text field the field's own editing chords (⌘Z, ⌘A, ⌘C, ⌘X, ⌘V, ⌘⌫)
stay the field's. Go to Referenced Row opens the foreign key's target filtered to the focused row's
values; Show Referencing Rows… lists the foreign keys pointing at this table and opens the chosen
one filtered to the selected row. Reload, a filter or sort change, Rerun, closing the tab,
disconnecting and quitting with pending changes ask Submit, Discard or Cancel. A connection that
closes on its own discards pending changes with a notice. The value panel edits text and JSON
cells; ⌘↵ writes the buffer. There is no manual transaction mode in the editor: `Tx: Auto`.

## Completion and navigation

Plan 009, decision 028. Completion and Go to Declaration run in the engine against the catalog
cache; the renderer sends text and a caret and never parses SQL. `SqlLanguage` has
`complete(request, catalog)` and `resolve(request, catalog)`; the built-ins spread
`sqlCompleter(options)` from `@table-craft/plugin-api/sql`, which a third-party plugin may use too:

| Plugin     | `identifierFolding` | `plainIdentifier`           | Quotes         | Extra keywords / functions                                    |
| ---------- | ------------------- | --------------------------- | -------------- | ------------------------------------------------------------- |
| PostgreSQL | `lower`             | `^[a-z_][a-z0-9_$]*$`       | `"Line Items"` | `ILIKE`, `LATERAL`, `RETURNING`; `array_agg`, `string_agg`, … |
| MySQL      | `none`              | `^[A-Za-z_][A-Za-z0-9_$]*$` | `` `x` ``      | `STRAIGHT_JOIN`, `REPLACE`; `group_concat`, `date_format`, …  |
| SQLite     | `none`              | `^[A-Za-z_][A-Za-z0-9_$]*$` | `"x"`          | `GLOB`, `PRAGMA`; `datetime`, `json_extract`, …               |

`scopeAt` reads the statement around the caret (cut at the lexer's `;` delimiters) into the clause
the caret is in, any `x.` qualifier before it, and the sources in scope: FROM and JOIN relations with
their aliases, comma joins, CTEs (columns from their column list, else their select list), derived
tables with an alias, `UPDATE t`, `INSERT INTO t (…)` and `DELETE FROM t`. A source that cannot be
resolved is ignored. Unqualified names resolve against the namespace flagged `current`.

| Caret                                                   | Offers                                                                              |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| After FROM, JOIN, UPDATE, INTO                          | CTEs, relations of the current namespace in catalog order, namespaces               |
| After JOIN                                              | also join items first: `customers c ON c.id = o.customer_id`                        |
| `x.`                                                    | columns of alias, relation or CTE `x`; relations of namespace `x`                   |
| Select list, WHERE, ON, GROUP BY, ORDER BY, HAVING, SET | in-scope columns (`o.id` when two sources share `id`), aliases, functions, keywords |
| `INSERT INTO t (`                                       | the columns of `t`                                                                  |
| Anywhere else                                           | keywords                                                                            |

A join item follows a foreign key from or to an in-scope relation, outgoing first. Its alias is the
initials of the relation's words (`Line Items` → `li`), suffixed with a digit when taken or a
keyword; a target in another namespace is qualified (`archive.old_orders oo ON …`). A name is quoted
only when it fails `plainIdentifier` or is a keyword; a prefix starting with a quote keeps the
labels quoted. Items are `{ label, kind, detail, apply, boost }`; `detail` is a column's type or a
relation's namespace, or the foreign key's name for a join. The engine orders them (join 50, column
40, CTE 35, table and view 30, alias 20, namespace 10, function 0, keyword −10) and the popup keeps
that order between equal fuzzy scores. `validFor` is `^[A-Za-z0-9_$]*$` unless the prefix is quoted.

The engine answers from `CatalogCache` through `core/catalog/completionCatalog.ts`. A namespace not
yet described is described on demand, waiting at most `COMPLETION_DESCRIBE_DEADLINE_MS = 1_500`;
past that the answer uses what is cached and the describe still lands in the cache. Completion runs
on the introspection session, never on a console's.

The console asks while connected: `⌃Space` at once, typing after a word character, `.` or a quote
after `COMPLETION_TYPING_DELAY_MS = 80`; an answer overtaken by a later request is dropped. A
console whose datasource is not connected offers `lang-sql`'s keywords and starts no engine. The
table editor's WHERE and ORDER BY bars complete with `scope: { path, relation }`: the bar's text is
read as the body of a WHERE on that relation. While the popup is open Enter accepts and Esc closes
it.

`navigation.resolve` answers what the name under the caret declares: `{ kind: "alias" | "cte",
from, to }` (the `orders o` span, or the CTE's name), `{ kind: "relation", path, relation }`,
`{ kind: "column", path, relation, column }`, or `null`.

| Action id                | Title             | macOS | Windows / Linux | Region         |
| ------------------------ | ----------------- | ----- | --------------- | -------------- |
| `editor.goToDeclaration` | Go to Declaration | `⌘B`  | `Ctrl+B`        | console editor |
| `editor.openData`        | Open Data         | `F4`  | `F4`            | console editor |

Go to Declaration on an alias or CTE moves the caret to its declaration and flashes it; on a
relation it opens the relation's DDL tab when the plugin declares `ddl` (DDL and SQL generation);
on a column, or a relation without `ddl`, it reveals the node in the Database tool window, expanding
and describing the way there, and focuses the tree. Open Data opens the relation under the caret,
through an alias, in a table tab. Both connect a disconnected console's datasource, being explicit
commands.

## DDL and SQL generation

Plan 010, decision 029. A relation's definition comes from the database, and the statements built
around it come from the plugin's language over the cached catalog.

`catalog.definition { path, name }` runs `Introspector.definition` on the introspection session and
is never cached. Each statement ends in `;`, separated from the next by a blank line. An unknown
relation answers `definitionNotFound`, whose hint says Synchronize.

| Plugin     | Definition                                                                                                                                                                                                                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL | assembled: `CREATE TABLE` with `format_type` types, identity, generated and `pg_get_expr` defaults, then constraints (`pg_get_constraintdef`, p u f c x); `CREATE INDEX` for indexes backing no constraint; `pg_get_viewdef(oid, true)` for views and materialized views; `COMMENT ON` the relation and columns |
| MySQL      | `SHOW CREATE TABLE` or `SHOW CREATE VIEW`, verbatim (`DEFINER`, `AUTO_INCREMENT=` included)                                                                                                                                                                                                                     |
| SQLite     | `sqlite_master.sql` for the relation, then its explicit indexes' and triggers'                                                                                                                                                                                                                                  |

`sql.generate { path, name, statement }` answers `create` with the definition, and `drop`, `select`,
`insert` and `update` with `language.generate(statement, relation, qualifiedName)`, the relation
read from the catalog cache and `qualifiedName` the introspector's. The built-ins spread
`sqlGenerator({ quoteIdentifier, updateDefault, plainIdentifier, keywords })` from
`@table-craft/plugin-api/sql`: one clause per line, columns in table order, column names quoted
only when the completer would quote them.

| Statement | Text for `orders` on PostgreSQL                                                                           |
| --------- | --------------------------------------------------------------------------------------------------------- |
| DROP      | `DROP TABLE "public"."orders";` (`DROP VIEW`, `DROP MATERIALIZED VIEW`); never `CASCADE`                  |
| SELECT    | `SELECT id, customer_id, total, placed_at` / `FROM "public"."orders";`                                    |
| INSERT    | every column but identity ones; each value the column's `updateDefault(default)`, else `NULL`             |
| UPDATE    | `SET` every non-key column `= NULL`, `WHERE` each primary-key column `= NULL` (every column when keyless) |

A generated UPDATE matches no row until edited, since `= NULL` is never true; the INSERT is the
only statement that writes as it stands.

A DDL tab (kind `ddl`, the DDL glyph, titled `orders [pg]`) is one per datasource, path and
relation; opening it again focuses it. Its body is a read-only, highlighted SQL view with a toolbar:
Refresh, Copy, Open in Console. It reads again whenever the renderer's catalog re-describes its
namespace, as after DDL in a console. DDL tabs are not restored on relaunch.

Quick Documentation is a popover (at most 480×360 px, scrolling) anchored at the selected tree row
or at the caret, drawn from the renderer's catalog copy with no request of its own; F1 at a caret
resolves the name with `navigation.resolve` (an alias resolves to its relation) and describes the
namespace if the tree never did. A relation shows its kind, qualified name, comment, columns (name,
type, `NOT NULL`, default, key marks), primary key, foreign keys out (→) and in (←), and indexes; a
column its type and nullability, default, comment and the keys and indexes it is in. `Esc` or a
click outside closes it.

The SQL Generator is a modal on the selected relation: a radio group CREATE / DROP / SELECT /
INSERT / UPDATE (CREATE only with `ddl`; SELECT chosen and focused; arrow keys move), a read-only
preview, and Open in Console or Copy. Every switch sends `sql.generate`.

| Action id           | Title               | macOS | Windows / Linux | Region                   |
| ------------------- | ------------------- | ----- | --------------- | ------------------------ |
| `ddl.open`          | Go to DDL           | `⌘B`  | `Ctrl+B`        | Database tool window     |
| `catalog.quickDoc`  | Quick Documentation | `F1`  | `F1`            | Database, console editor |
| `sql.generator`     | SQL Generator…      | `⌥⌘G` | `Ctrl+Alt+G`    | Database tool window     |
| `ddl.refresh`       | Refresh DDL         |       |                 | DDL tab                  |
| `ddl.copy`          | Copy DDL            |       |                 | DDL tab                  |
| `ddl.openInConsole` | Open DDL in Console |       |                 | DDL tab                  |

Go to DDL and the generator's CREATE need `ddl` (decision 007). The context menu of a relation in
the Database tool window reads Open Data, Go to DDL, Quick Documentation, SQL Generator…, New
Console, then Synchronize and Copy Qualified Name; a column's starts with Quick Documentation.

## Query history and Services

Plan 011, decision 030. Main keeps the query history in `<userData>/history.sqlite`, opened with
`node:sqlite` by core's `history/` (`openQueryHistory`): one table `entries` (`id`,
`datasource_id`, `sql`, `started_at`, `duration_ms`, `outcome` success, error or cancelled,
`row_count`, `message`, `source` console or table), `user_version` 1, WAL. A file that does not
open as that schema is renamed `history.sqlite.corrupt-<ms>` and a fresh one is created. Each
datasource keeps its newest `HISTORY_LIMIT = 10_000` entries; recording prunes the oldest. Search
answers distinct statement texts, newest first, at most `HISTORY_SEARCH_LIMIT = 200`, each with its
last start, duration, outcome, row count and message and how many times it ran; the query matches
anywhere in the text, case-insensitively and literally (`%` and `_` are plain characters).
Deleting a datasource clears its history, and its confirmation says so.

The renderer records, fire-and-forget over `history.record`; a failed write is logged and the run
goes on. Recorded: every statement a console runs (Run, Run All, Rerun) when it succeeds, fails or
is cancelled, with the duration of the statement alone, its row count (rows retrieved, else rows
affected) and the error's message. Not recorded: statements a failure skipped, a batch whose
destructive confirmation was declined, `Nothing to run`, table loads and counts, and anything on the
`TABLE_CRAFT_DATASOURCE` datasource. A successful table submit is one entry with source `table`
whose text is its statements, each ending in `;`, one per line.

Query History… (`⌥⌘E`) works on the active console's datasource or the selected one in the Database
tool window, whose context menu lists it after New Console. The dialog is a `ListPicker`
(`renderer/ui/ListPicker.tsx`): a search field over the statements, a list showing each one's
outcome dot, first line, `×3` when it ran more than once, rows, duration and time (`13:28:57`
today, else `2026-10-21 13:28`), and the selected statement in full in a read-only SQL view, with
its error message above it. `↑`/`↓` move, Enter or Insert puts the statement at the console's
caret, replacing the selection as one undo step, and focuses the editor; from the Database tool
window the button reads Open in Console and opens a new console with the text. Copy puts it on the
clipboard; Clear History… asks `Clear the query history of pg? This cannot be undone.` and shows
the emptied list.

Services is a tree (`renderer/model/servicesTree.ts`) with the Database tool window's keyboard
model: each datasource with an open console or table tab and its connection state, under it one
session per tab (console or table glyph, the tab's title, idle, running, failed or disconnected,
the last run's duration), and under each session its last `EXECUTIONS_PER_SESSION = 50` executions,
newest first, kept in the renderer for as long as the tab is open (`renderer/state/executions.ts`).
An execution shows its outcome glyph, a spinner and the elapsed time ticking each second while it
runs, its label (a console statement's first line, `Load rows`, `Count rows`, `Submit 2
statements`), rows, duration and start time. Everything starts expanded; `No open sessions.` when
there is nothing. Enter or a click on a session or execution activates its tab. A session's context
menu holds Cancel Running Statement while a console runs and Clear Executions; an execution with
SQL holds Copy Execution SQL and Open Execution in Console.

Open Closed Console… (on a saved datasource, from its context menu, the palette or one of its
consoles) lists the datasource's console files that no tab has open, by name, with the selected
one's text in a read-only SQL view. Enter or Open reopens it as a tab under its own name; Delete…
removes the file after a confirmation and shows the list again.

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

| Channel (`table-craft:` …) | Request                          | Value                                                                |
| -------------------------- | -------------------------------- | -------------------------------------------------------------------- |
| `datasources.list`         | none                             | `{ datasources, warning, encryption: { available, reason } }`        |
| `datasources.save`         | `{ datasource, secrets }`        | the saved datasource                                                 |
| `datasources.delete`       | `id`                             | `null`; stops its engine, clears its secrets, consoles and history   |
| `datasources.test`         | `{ datasource, secrets }`        | the probe result; stored secrets are merged in main                  |
| `plugins.list`             | none                             | `{ id, name, unavailableReason, capabilities, fields, highlight }[]` |
| `consoles.list`            | `datasourceId`                   | the saved console names, sorted                                      |
| `consoles.read`            | `datasourceId`, `name`           | the text, or `null` when there is no file                            |
| `consoles.write`           | `datasourceId`, `name`, `text`   | `null`; written atomically                                           |
| `consoles.delete`          | `datasourceId`, `name`           | `null`; deleting a missing file is not an error                      |
| `history.record`           | a `HistoryEntry`                 | `null`                                                               |
| `history.search`           | `datasourceId`, `query`          | `HistoryStatement[]`, newest first                                   |
| `history.clear`            | `datasourceId`                   | `null`                                                               |
| `window.answer-close`      | `proceed`                        | `null`; closes the window, or finishes the quit (decision 024)       |
| `engine.connect`           | `datasourceId`, typed `secrets?` | `connected`, `needsSecrets { keys }` or `failed`                     |
| `engine.disconnect`        | `datasourceId`                   | `null` once the engine has exited                                    |
| `dialog.choose-file`       | `title`                          | a path, or `null`                                                    |

Console ids and names must match `CONSOLE_NAME_PATTERN = /^[\w.-]{1,64}$/` and not be dots alone,
so no request leaves `<userData>/consoles/`. A listed datasource carries `storedSecrets` (the keys
main can use without asking), never values.
`secrets` in a save or test maps each secret key to `keep`, `set { value }` or `clear`. Main
broadcasts `datasources.changed` with the new list after every save or delete, and
`engine.exited { datasourceId, code, clean }` when an engine ends, and sends
`window.close-requested` when the window is asked to close. On `connected` the port arrives
as `table-craft:engine-port` with the datasource id, relayed by preload as a window message; a
window holds one port per connected datasource.

### Database tool window

Datasources sit in folders, folders first, each level sorted by name. A node shows the plugin
icon, the name, the colour swatch, a lock when read-only, and its state: disconnected,
connecting, connected, failed with the error, or "failed: engine exited". A toolbar carries New
Data Source, Properties, Synchronize, Connect, Disconnect, New Console and Collapse All; each node's
context menu carries the datasource actions. Enter or a double-click opens a console. With no
datasources the window shows "No data sources." and a New Data Source button.

### Database explorer

A datasource whose plugin declares `schemaTree` expands into its catalog (plan 005,
`datagrip-inventory.md` §3). The tree is one flat, virtualized list built by
`renderer/model/explorerTree.ts` from the datasource list and `renderer/state/catalog.ts`:

| Node                    | Children                                                                 | Shows                                              |
| ----------------------- | ------------------------------------------------------------------------ | -------------------------------------------------- |
| datasource              | its namespaces, hierarchical by path                                     | as above                                           |
| namespace (database)    | its schemas                                                              | the name                                           |
| namespace (schema)      | groups `tables`, `views`, `materialized views`, `routines`, `sequences`  | the name; a spinner while synchronizing            |
| group                   | its objects; a group exists only when non-empty                          | `tables 3`                                         |
| table, view             | `columns N`, `keys`, `foreign keys`, `indexes`, each only when non-empty | the name                                           |
| column                  | none                                                                     | `name  type`, key icon for PK or FK, NOT NULL mark |
| key, foreign key, index | none                                                                     | the name and its columns; `(a) → t(b)`; `unique`   |
| `loading…`, error       | none                                                                     | a spinner; the error's message, hint beside it     |

Expanding a disconnected datasource connects it; whenever a datasource attaches, by the tree or by a
console, its namespaces are listed and the current one is described and expanded. Expanding a
schema describes it once; Synchronize (`⌥⌘Y`) describes the selected namespace again, or relists
namespaces on a datasource node. A namespace that fails to describe turns the danger colour, shows
the error under it, and leaves its siblings alone; Synchronize retries it. Detaching a datasource
for any reason clears its catalog. System namespaces are hidden unless Show System Schemas is on,
which the window's layout remembers.

With the tree focused, typing opens speed search over loaded rows only: matched characters are
marked, the selection jumps to the first match, `↑`/`↓` step between matches and wrap, Enter keeps
the selection, Esc closes; no match turns the field the danger colour. A contiguous run is marked
before a fuzzy match, so `cust` marks `cust` in `customer_totals`. Search Everywhere's `Tables` tab
lists every loaded relation as `orders` with `pg › table_craft › public` beside it; choosing one
runs Select in Database View, which opens the tool window, expands the path and selects it. Copy
Qualified Name puts the plugin's quoting on the clipboard (`catalog.qualifiedName`).

The status bar's `sync` item reads `public synchronized (38 ms) · 2 min ago` for the selected
namespace of the active datasource, else its current one, refreshed every minute
(`SYNC_LABEL_TICK_MS`), or `explorer_restricted failed: …` with the hint when the selected one
failed.

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
