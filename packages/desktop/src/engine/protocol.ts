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
export type Capability = "sql" | "cancel";

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

/** Mirrors `ResultSummary` in core, with the first window attached. */
export interface ExecutedStatement {
  readonly handle: string;
  readonly columns: readonly Column[];
  readonly rowCount: number;
  readonly truncated: boolean;
  readonly rowsAffected: number | null;
  readonly firstWindow: ResultWindow;
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
  "result.window": {
    params: { readonly handle: string; readonly offset: number; readonly limit: number };
    result: ResultWindow;
  };
  "result.release": { params: { readonly handle: string }; result: null };
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
