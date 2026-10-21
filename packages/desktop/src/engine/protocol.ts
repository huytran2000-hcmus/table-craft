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

/** The one datasource an engine host serves. Plan 001 hard-wires it in main. */
export interface DatasourceConfig {
  readonly id: string;
  readonly pluginId: string;
  readonly config: unknown;
}

export interface EngineBoot {
  readonly kind: typeof ENGINE_BOOT_MESSAGE;
  readonly datasource: DatasourceConfig;
  /** Directories whose subdirectories are plugins, in precedence order (decision 005). */
  readonly pluginRoots: readonly string[];
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

/** The engine's calls: what each request carries and what its response answers with. */
export interface EngineCalls {
  "session.open": { params: Record<never, never>; result: { readonly sessionId: string } };
  "statement.execute": { params: { readonly sessionId: string; readonly sql: string }; result: ExecutedStatement };
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
  | "statementFailed"
  | "invalidRequest"
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
