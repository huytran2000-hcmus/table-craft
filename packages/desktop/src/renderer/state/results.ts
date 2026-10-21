import { create } from "zustand";
import {
  RESULT_WINDOW_ROWS,
  type Capability,
  type Column,
  type EngineError,
  type Row,
} from "@table-craft/desktop/engine/protocol.js";
import { connectEngine, EngineRequestError, type EngineClient } from "@table-craft/desktop/renderer/engine/client.js";

export type ConsoleStatus = "connecting" | "ready" | "running" | "failed";

export interface ShownResult {
  readonly handle: string;
  readonly columns: readonly Column[];
  readonly rowCount: number;
  readonly truncated: boolean;
  readonly rowsAffected: number | null;
}

export interface ResultState {
  readonly status: ConsoleStatus;
  readonly error: EngineError | null;
  readonly result: ShownResult | null;
  /** The datasource plugin's manifest name, once a session is open. */
  readonly pluginName: string | null;
  readonly capabilities: readonly Capability[];
  /** Loaded windows keyed by their offset, a multiple of `RESULT_WINDOW_ROWS`. */
  readonly windows: Readonly<Record<number, readonly Row[]>>;
  readonly connect: () => Promise<void>;
  readonly run: (sql: string) => Promise<void>;
  /** Asks the engine to cancel the running statement; `run` then reports it as cancelled. */
  readonly cancel: () => Promise<void>;
  readonly ensureWindow: (offset: number) => void;
}

const UNEXPECTED_HINT = "Restart the app; if it happens again, report it.";

function toError(cause: unknown): EngineError {
  if (cause instanceof EngineRequestError) return { code: cause.code, message: cause.message, hint: cause.hint };
  return { code: "internal", message: cause instanceof Error ? cause.message : String(cause), hint: UNEXPECTED_HINT };
}

/** The window offset that holds row `index`. */
export function windowOffsetOf(index: number): number {
  return Math.floor(index / RESULT_WINDOW_ROWS) * RESULT_WINDOW_ROWS;
}

export function rowAt(windows: ResultState["windows"], index: number): Row | undefined {
  const offset = windowOffsetOf(index);
  return windows[offset]?.[index - offset];
}

let client: EngineClient | null = null;
let sessionId: string | null = null;
/** Window requests in flight for the shown handle; not state, because nothing renders from it. */
const requested = new Set<number>();

export const useResults = create<ResultState>()((set, get) => ({
  status: "connecting",
  error: null,
  result: null,
  pluginName: null,
  capabilities: [],
  windows: {},

  async connect() {
    try {
      client = await connectEngine();
      const opened = await client.call("session.open", {});
      sessionId = opened.sessionId;
      set({ status: "ready", error: null, pluginName: opened.pluginName, capabilities: opened.capabilities });
    } catch (cause) {
      set({ status: "failed", error: toError(cause) });
    }
  },

  async run(sql) {
    if (client === null || sessionId === null) return;
    const previous = get().result;
    set({ status: "running", error: null });
    try {
      const executed = await client.call("statement.execute", { sessionId, sql });
      requested.clear();
      if (previous !== null) void client.call("result.release", { handle: previous.handle });
      const { firstWindow, ...result } = executed;
      set({ status: "ready", result, windows: { [firstWindow.offset]: firstWindow.rows } });
    } catch (cause) {
      set({ status: "ready", error: toError(cause) });
    }
  },

  async cancel() {
    if (client === null || sessionId === null || get().status !== "running") return;
    try {
      await client.call("statement.cancel", { sessionId });
    } catch (cause) {
      set({ error: toError(cause) });
    }
  },

  ensureWindow(offset) {
    const { result, windows } = get();
    if (client === null || result === null || offset in windows || requested.has(offset)) return;
    requested.add(offset);
    const { handle } = result;
    client
      .call("result.window", { handle, offset, limit: RESULT_WINDOW_ROWS })
      .then((window) => {
        if (get().result?.handle !== handle) return;
        set({ windows: { ...get().windows, [window.offset]: window.rows } });
      })
      .catch((cause: unknown) => set({ error: toError(cause) }))
      .finally(() => requested.delete(offset));
  },
}));
