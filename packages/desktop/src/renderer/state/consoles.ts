import { create } from "zustand";
import {
  RESULT_WINDOW_ROWS,
  type Capability,
  type Column,
  type EngineError,
  type Row,
} from "@table-craft/desktop/engine/protocol.js";
import { connectEngine, EngineRequestError, type EngineClient } from "@table-craft/desktop/renderer/engine/client.js";

/** One console's session: `failed` when it could not open, after which it never runs. */
export type ConsoleStatus = "connecting" | "ready" | "running" | "failed";

export interface ShownResult {
  readonly handle: string;
  readonly columns: readonly Column[];
  readonly rowCount: number;
  readonly truncated: boolean;
  readonly rowsAffected: number | null;
}

export type RunOutcome = "succeeded" | "failed" | "cancelled";

export interface LastRun {
  readonly durationMs: number;
  readonly outcome: RunOutcome;
}

export interface ConsoleSession {
  readonly sessionId: string | null;
  readonly status: ConsoleStatus;
  readonly error: EngineError | null;
  readonly sql: string;
  readonly result: ShownResult | null;
  /** Loaded windows keyed by their offset, a multiple of `RESULT_WINDOW_ROWS`. */
  readonly windows: Readonly<Record<number, readonly Row[]>>;
  readonly lastRun: LastRun | null;
}

export type DatasourceStatus = "connecting" | "connected" | "failed";

/** What the latest session open said about the one datasource (decision 018). */
export interface DatasourceState {
  readonly status: DatasourceStatus;
  readonly error: EngineError | null;
  /** The plugin's manifest name, once a session has opened. */
  readonly pluginName: string | null;
  readonly capabilities: readonly Capability[];
}

export interface ConsolesState {
  readonly datasource: DatasourceState;
  readonly consoles: Readonly<Record<string, ConsoleSession>>;
  /** Opens a session for a new console tab. */
  readonly open: (id: string, sql?: string) => Promise<void>;
  /** Forgets the console and closes its session, which releases its result. */
  readonly close: (id: string) => void;
  readonly setSql: (id: string, sql: string) => void;
  readonly run: (id: string) => Promise<void>;
  /** Asks the engine to cancel the running statement; `run` then reports it as cancelled. */
  readonly cancel: (id: string) => Promise<void>;
  readonly ensureWindow: (id: string, offset: number) => void;
}

export const INITIAL_SQL = "SELECT 1 AS one, 'two' AS two";
const UNEXPECTED_HINT = "Restart the app; if it happens again, report it.";

export function toError(cause: unknown): EngineError {
  if (cause instanceof EngineRequestError) return { code: cause.code, message: cause.message, hint: cause.hint };
  return { code: "internal", message: cause instanceof Error ? cause.message : String(cause), hint: UNEXPECTED_HINT };
}

/** The window offset that holds row `index`. */
export function windowOffsetOf(index: number): number {
  return Math.floor(index / RESULT_WINDOW_ROWS) * RESULT_WINDOW_ROWS;
}

export function rowAt(windows: ConsoleSession["windows"], index: number): Row | undefined {
  const offset = windowOffsetOf(index);
  return windows[offset]?.[index - offset];
}

export interface ConsolesDependencies {
  /** Called once per window, on the first console: the port is one per window (decision 002). */
  readonly connect: () => Promise<EngineClient>;
  readonly now: () => number;
}

function newConsole(sql: string): ConsoleSession {
  return { sessionId: null, status: "connecting", error: null, sql, result: null, windows: {}, lastRun: null };
}

export function createConsolesStore(dependencies: ConsolesDependencies) {
  let client: Promise<EngineClient> | null = null;
  /** Window requests in flight per console; not state, because nothing renders from it. */
  const requested = new Map<string, Set<number>>();

  function engine(): Promise<EngineClient> {
    client ??= dependencies.connect();
    return client;
  }

  return create<ConsolesState>()((set, get) => {
    function patch(id: string, change: Partial<ConsoleSession>): void {
      const current = get().consoles[id];
      if (current === undefined) return;
      set({ consoles: { ...get().consoles, [id]: { ...current, ...change } } });
    }

    return {
      datasource: { status: "connecting", error: null, pluginName: null, capabilities: [] },
      consoles: {},

      async open(id, sql = INITIAL_SQL) {
        set({ consoles: { ...get().consoles, [id]: newConsole(sql) } });
        try {
          const engineClient = await engine();
          const opened = await engineClient.call("session.open", {});
          if (get().consoles[id] === undefined) {
            // Its tab closed while the session opened.
            void engineClient.call("session.close", { sessionId: opened.sessionId }).catch(() => undefined);
            return;
          }
          set({
            datasource: {
              status: "connected",
              error: null,
              pluginName: opened.pluginName,
              capabilities: opened.capabilities,
            },
          });
          patch(id, { sessionId: opened.sessionId, status: "ready", error: null });
        } catch (cause) {
          const error = toError(cause);
          set({ datasource: { ...get().datasource, status: "failed", error } });
          patch(id, { status: "failed", error });
        }
      },

      close(id) {
        const closing = get().consoles[id];
        if (closing === undefined) return;
        const { [id]: _closed, ...rest } = get().consoles;
        set({ consoles: rest });
        requested.delete(id);
        if (closing.sessionId === null || client === null) return;
        const { sessionId } = closing;
        void client.then((engineClient) => engineClient.call("session.close", { sessionId })).catch(() => undefined);
      },

      setSql(id, sql) {
        patch(id, { sql });
      },

      async run(id) {
        const current = get().consoles[id];
        if (client === null || current?.sessionId == null || current.status !== "ready") return;
        const { sessionId, sql, result: previous } = current;
        const startedAt = dependencies.now();
        patch(id, { status: "running", error: null });
        const finished = (outcome: RunOutcome): LastRun => ({ durationMs: dependencies.now() - startedAt, outcome });
        try {
          const engineClient = await client;
          const executed = await engineClient.call("statement.execute", { sessionId, sql });
          requested.get(id)?.clear();
          if (previous !== null) void engineClient.call("result.release", { handle: previous.handle });
          const { firstWindow, ...result } = executed;
          patch(id, {
            status: "ready",
            result,
            windows: { [firstWindow.offset]: firstWindow.rows },
            lastRun: finished("succeeded"),
          });
        } catch (cause) {
          const error = toError(cause);
          patch(id, {
            status: "ready",
            error,
            lastRun: finished(error.code === "cancelled" ? "cancelled" : "failed"),
          });
        }
      },

      async cancel(id) {
        const current = get().consoles[id];
        if (client === null || current?.sessionId == null || current.status !== "running") return;
        const { sessionId } = current;
        try {
          await (await client).call("statement.cancel", { sessionId });
        } catch (cause) {
          patch(id, { error: toError(cause) });
        }
      },

      ensureWindow(id, offset) {
        const current = get().consoles[id];
        if (client === null || current?.result == null || offset in current.windows) return;
        const inFlight = requested.get(id) ?? new Set<number>();
        requested.set(id, inFlight);
        if (inFlight.has(offset)) return;
        inFlight.add(offset);
        const { handle } = current.result;
        client
          .then((engineClient) => engineClient.call("result.window", { handle, offset, limit: RESULT_WINDOW_ROWS }))
          .then((window) => {
            const latest = get().consoles[id];
            if (latest?.result?.handle !== handle) return;
            patch(id, { windows: { ...latest.windows, [window.offset]: window.rows } });
          })
          .catch((cause: unknown) => patch(id, { error: toError(cause) }))
          .finally(() => inFlight.delete(offset));
      },
    };
  });
}

export type ConsolesStore = ReturnType<typeof createConsolesStore>;

export const useConsoles = createConsolesStore({ connect: connectEngine, now: () => performance.now() });
