/**
 * Every message between the renderer and an engine host (decision 002). The renderer may not
 * import core or plugin-api, so the wire types and constants both sides need are restated here
 * and pinned to their originals by `test/desktop/protocol.test.ts`.
 */

/** Mirrors `RESULT_WINDOW_ROWS` in core: the most rows one `result.window` returns. */
export const RESULT_WINDOW_ROWS = 500;
/** Mirrors `RESULT_FETCH_CAP` in core: the most rows a result set keeps before it is truncated. */
export const RESULT_FETCH_CAP = 10_000;

/** What main posts on the engine's parent port, once, before any renderer port arrives. */
export const ENGINE_BOOT_MESSAGE = "engine.boot";
/** What main posts on the engine's parent port alongside a fresh renderer port. */
export const ENGINE_PORT_MESSAGE = "engine.port";
/** What main posts on the engine's parent port to have it close every session and exit. */
export const ENGINE_SHUTDOWN_MESSAGE = "engine.shutdown";
/** What a probe engine posts on its parent port, once, before it exits. */
export const ENGINE_PROBED_MESSAGE = "engine.probed";

/** Mirrors `WireValue` in plugin-api. */
export type WireValue =
  | null
  | boolean
  | number
  | string
  | { readonly kind: "bigint"; readonly value: string }
  | { readonly kind: "bytes"; readonly preview: string; readonly length: number }
  | { readonly kind: "json"; readonly text: string }
  | { readonly kind: "date"; readonly iso: string };

export type Row = readonly WireValue[];

/** Mirrors `Column` in plugin-api. */
export interface Column {
  readonly name: string;
  readonly type: string | null;
}

/** Mirrors `Capability` in plugin-api. The renderer branches on these, never on a plugin id (decision 007). */
export type Capability = "sql" | "cancel" | "schemaTree" | "transactions";

/** Mirrors `StatementKind` in plugin-api. */
export type StatementKind = "read" | "write" | "ddl" | "transaction" | "other";

/** Mirrors `TransactionMode` in plugin-api: `auto` commits each statement, `manual` holds one transaction open. */
export type TransactionMode = "auto" | "manual";

/** One statement of a script: its span in UTF-16 offsets, as the plugin split it, and its class. */
export interface ClassifiedStatement {
  readonly from: number;
  readonly to: number;
  readonly sql: string;
  readonly kind: StatementKind;
  /** Why the console asks before running it, such as `DELETE without WHERE`; null when it need not. */
  readonly destructive: string | null;
}

/** A session's transaction after a transaction request. */
export interface TransactionState {
  readonly mode: TransactionMode;
  readonly transactionOpen: boolean;
}

/** Mirrors `Namespace` in plugin-api. */
export interface Namespace {
  readonly path: readonly string[];
  readonly name: string;
  readonly kind: "database" | "schema";
  readonly system: boolean;
  readonly current: boolean;
}

/** Mirrors `ColumnMeta` in plugin-api. */
export interface ColumnMeta {
  readonly name: string;
  readonly position: number;
  readonly type: string;
  readonly nullable: boolean;
  readonly default: string | null;
  readonly comment: string | null;
  readonly autoIncrement: boolean;
}

/** Mirrors `Key` in plugin-api. */
export interface Key {
  readonly name: string;
  readonly columns: readonly string[];
}

/** Mirrors `ForeignKey` in plugin-api. */
export interface ForeignKey {
  readonly name: string;
  readonly columns: readonly string[];
  readonly target: {
    readonly path: readonly string[];
    readonly relation: string;
    readonly columns: readonly string[];
  };
  readonly onDelete: string;
  readonly onUpdate: string;
}

/** Mirrors `Index` in plugin-api. */
export interface Index {
  readonly name: string;
  readonly columns: readonly string[];
  readonly unique: boolean;
  readonly primary: boolean;
}

/** Mirrors `RelationKind` in plugin-api. */
export type RelationKind = "table" | "view" | "materializedView";

/** Mirrors `Relation` in plugin-api. */
export interface Relation {
  readonly name: string;
  readonly kind: RelationKind;
  readonly comment: string | null;
  readonly columns: readonly ColumnMeta[];
  readonly primaryKey: Key | null;
  readonly uniqueKeys: readonly Key[];
  readonly foreignKeys: readonly ForeignKey[];
  readonly indexes: readonly Index[];
}

/** Mirrors `Routine` in plugin-api. */
export interface Routine {
  readonly name: string;
  readonly kind: "function" | "procedure";
}

/** Mirrors `Sequence` in plugin-api. */
export interface Sequence {
  readonly name: string;
}

/** Mirrors `NamespaceCatalog` in plugin-api. */
export interface NamespaceCatalog {
  readonly path: readonly string[];
  readonly relations: readonly Relation[];
  readonly routines: readonly Routine[];
  readonly sequences: readonly Sequence[];
}

/** Mirrors `CachedCatalog` in core: a catalog and when, and how fast, it was read. */
export interface DescribedCatalog {
  readonly catalog: NamespaceCatalog;
  /** Epoch milliseconds. */
  readonly introspectedAt: number;
  readonly elapsedMs: number;
}

/**
 * The one datasource an engine host serves. Main assembles it from `datasources.json` and the
 * secret store, so `config` carries decrypted secrets and never travels to the renderer.
 */
export interface DatasourceConfig {
  readonly id: string;
  readonly pluginId: string;
  readonly config: unknown;
  /** Every session asks the database to refuse writes (decision 011). */
  readonly readOnly: boolean;
}

/** `serve` answers renderer ports until the last closes; `probe` tests one connection and exits. */
export type EngineMode = "serve" | "probe";

export interface EngineBoot {
  readonly kind: typeof ENGINE_BOOT_MESSAGE;
  readonly mode: EngineMode;
  readonly datasource: DatasourceConfig;
  /** Directories whose subdirectories are plugins, in precedence order (decision 005). */
  readonly pluginRoots: readonly string[];
}

/** What Test Connection shows: the server that answered, or why none did. */
export type ProbeResult =
  | {
      readonly ok: true;
      readonly pluginName: string;
      readonly serverVersion: string | null;
      readonly elapsedMs: number;
    }
  | { readonly ok: false; readonly error: EngineError };

export interface EngineProbed {
  readonly kind: typeof ENGINE_PROBED_MESSAGE;
  readonly result: ProbeResult;
}

export interface ResultWindow {
  readonly offset: number;
  readonly rows: readonly Row[];
}

/** Mirrors `ResultSummary` in core, with the first window and the session's transaction attached. */
export interface ExecutedStatement {
  readonly handle: string;
  readonly columns: readonly Column[];
  readonly rowCount: number;
  readonly truncated: boolean;
  readonly rowsAffected: number | null;
  readonly firstWindow: ResultWindow;
  /** Whether the session holds a transaction open after the statement; always false without `transactions`. */
  readonly transactionOpen: boolean;
}

export interface OpenedSession {
  readonly sessionId: string;
  /** The datasource's plugin, by its manifest name, for display only. */
  readonly pluginName: string;
  readonly capabilities: readonly Capability[];
  /** What the server reports about itself, for the status bar; null when it reports nothing. */
  readonly serverVersion: string | null;
}

/** The engine's calls: what each request carries and what its response answers with. */
export interface EngineCalls {
  "session.open": { params: Record<never, never>; result: OpenedSession };
  /** Closes the session and releases every result it produced. */
  "session.close": { params: { readonly sessionId: string }; result: null };
  "statement.execute": { params: { readonly sessionId: string; readonly sql: string }; result: ExecutedStatement };
  /** Cancels the statement running in the session, if any; its `statement.execute` fails with `cancelled`. */
  "statement.cancel": { params: { readonly sessionId: string }; result: null };
  /** Splits and classifies `text` with the datasource plugin's language; needs no session. */
  "script.split": { params: { readonly text: string }; result: readonly ClassifiedStatement[] };
  /** Switching to `auto` while a transaction is open fails with `statementFailed`. Needs `transactions`. */
  "transaction.setMode": {
    params: { readonly sessionId: string; readonly mode: TransactionMode };
    result: TransactionState;
  };
  /** Commits the open transaction; does nothing when none is open. Needs `transactions`. */
  "transaction.commit": { params: { readonly sessionId: string }; result: TransactionState };
  /** Rolls back the open transaction; does nothing when none is open. Needs `transactions`. */
  "transaction.rollback": { params: { readonly sessionId: string }; result: TransactionState };
  "result.window": {
    params: { readonly handle: string; readonly offset: number; readonly limit: number };
    result: ResultWindow;
  };
  "result.release": { params: { readonly handle: string }; result: null };
  /**
   * The datasource's namespaces, from the engine's cache unless `refresh`; the first call opens the
   * engine's introspection session (decision 022). Needs `schemaTree`.
   */
  "catalog.namespaces": { params: { readonly refresh?: boolean }; result: readonly Namespace[] };
  /** One namespace's objects, from the engine's cache unless `refresh`. Needs `schemaTree`. */
  "catalog.describe": {
    params: { readonly path: readonly string[]; readonly refresh?: boolean };
    result: DescribedCatalog;
  };
  /** `name` inside `path`, quoted by the plugin (decision 008). Needs `schemaTree`. */
  "catalog.qualifiedName": { params: { readonly path: readonly string[]; readonly name: string }; result: string };
}

export type EngineMethod = keyof EngineCalls;

export type RequestOf<M extends EngineMethod> = { readonly id: number; readonly type: M } & EngineCalls[M]["params"];
export type EngineRequest = { [M in EngineMethod]: RequestOf<M> }[EngineMethod];

export type ResultOf<M extends EngineMethod> = EngineCalls[M]["result"];
export interface EngineResult<M extends EngineMethod = EngineMethod> {
  readonly id: number;
  readonly type: M;
  readonly result: ResultOf<M>;
}

/** Core's codes, plus the ones only the engine can raise. */
export type EngineErrorCode =
  | "unknownHandle"
  | "unknownPlugin"
  | "pluginUnavailable"
  | "invalidConfig"
  | "unknownSession"
  | "connectionFailed"
  | "statementFailed"
  | "cancelled"
  | "introspectionFailed"
  | "invalidRequest"
  | "timedOut"
  | "internal";

export interface EngineError {
  readonly code: EngineErrorCode;
  readonly message: string;
  /** What the user can do next. */
  readonly hint: string;
}

export interface EngineErrorMessage {
  /** The request that failed, or `null` when the request was unreadable. */
  readonly id: number | null;
  readonly type: "engine.error";
  readonly error: EngineError;
}

export type EngineResponse = { [M in EngineMethod]: EngineResult<M> }[EngineMethod] | EngineErrorMessage;
