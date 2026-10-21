import { create } from "zustand";
import { RESULT_WINDOW_ROWS, type Column, type EngineError, type Row } from "@table-craft/desktop/engine/protocol.js";
import { EngineRequestError, type EngineClient } from "@table-craft/desktop/renderer/engine/client.js";
import { useDatasources } from "@table-craft/desktop/renderer/state/datasources.js";

/**
 * One console's session. `failed` when it could not open and `disconnected` when its engine went
 * away; Run opens a new session from either.
 */
export type ConsoleStatus = "connecting" | "ready" | "running" | "failed" | "disconnected";

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
  readonly datasourceId: string;
  readonly sessionId: string | null;
  readonly status: ConsoleStatus;
  readonly error: EngineError | null;
  readonly sql: string;
  readonly result: ShownResult | null;
  /** Loaded windows keyed by their offset, a multiple of `RESULT_WINDOW_ROWS`. */
  readonly windows: Readonly<Record<number, readonly Row[]>>;
  readonly lastRun: LastRun | null;
}

export interface ConsolesState {
  readonly consoles: Readonly<Record<string, ConsoleSession>>;
  /** Opens a session on `datasourceId` for a new console tab. */
  readonly open: (id: string, datasourceId: string, sql?: string) => Promise<void>;
  /** Forgets the console and closes its session, which releases its result. */
  readonly close: (id: string) => void;
  /** Marks the datasource's consoles disconnected; `error` says why when it was not asked for. */
  readonly detach: (datasourceId: string, error: EngineError | null) => void;
  readonly setSql: (id: string, sql: string) => void;
  /** Runs the console's SQL, opening a new session first when it has none. */
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

/** Whether Run can start from this status; it reconnects from the last two. */
export function canRun(status: ConsoleStatus): boolean {
  return status === "ready" || status === "disconnected" || status === "failed";
}

export interface ConsolesDependencies {
  /** The datasource's engine, connected on first use; one port per datasource per window. */
  readonly connect: (datasourceId: string) => Promise<EngineClient>;
  readonly now: () => number;
}

function newConsole(datasourceId: string, sql: string): ConsoleSession {
  return {
    datasourceId,
    sessionId: null,
    status: "connecting",
    error: null,
    sql,
    result: null,
    windows: {},
    lastRun: null,
  };
}

export function createConsolesStore(dependencies: ConsolesDependencies) {
  /** The client each console's session lives on; not state, because nothing renders from it. */
  const clients = new Map<string, EngineClient>();
  /** Window requests in flight per console. */
  const requested = new Map<string, Set<number>>();

  return create<ConsolesState>()((set, get) => {
    function patch(id: string, change: Partial<ConsoleSession>): void {
      const current = get().consoles[id];
      if (current === undefined) return;
      set({ consoles: { ...get().consoles, [id]: { ...current, ...change } } });
    }

    /** Opens a session for the console; false when it could not, with the console marked failed. */
    async function openSession(id: string): Promise<boolean> {
      const current = get().consoles[id];
      if (current === undefined) return false;
      patch(id, { status: "connecting", error: null });
      try {
        const client = await dependencies.connect(current.datasourceId);
        const opened = await client.call("session.open", {});
        if (get().consoles[id] === undefined) {
          // Its tab closed while the session opened.
          void client.call("session.close", { sessionId: opened.sessionId }).catch(() => undefined);
          return false;
        }
        clients.set(id, client);
        patch(id, { sessionId: opened.sessionId, status: "ready", error: null });
        return true;
      } catch (cause) {
        patch(id, { status: "failed", error: toError(cause) });
        return false;
      }
    }

    return {
      consoles: {},

      async open(id, datasourceId, sql = INITIAL_SQL) {
        set({ consoles: { ...get().consoles, [id]: newConsole(datasourceId, sql) } });
        await openSession(id);
      },

      close(id) {
        const closing = get().consoles[id];
        if (closing === undefined) return;
        const { [id]: _closed, ...rest } = get().consoles;
        set({ consoles: rest });
        requested.delete(id);
        const client = clients.get(id);
        clients.delete(id);
        if (closing.sessionId === null || client === undefined) return;
        void client.call("session.close", { sessionId: closing.sessionId }).catch(() => undefined);
      },

      detach(datasourceId, error) {
        const consoles = { ...get().consoles };
        let changed = false;
        for (const [id, session] of Object.entries(consoles)) {
          if (session.datasourceId !== datasourceId) continue;
          clients.delete(id);
          requested.delete(id);
          consoles[id] = {
            ...session,
            sessionId: null,
            status: error === null ? "disconnected" : "failed",
            error: error ?? session.error,
          };
          changed = true;
        }
        if (changed) set({ consoles });
      },

      setSql(id, sql) {
        patch(id, { sql });
      },

      async run(id) {
        const before = get().consoles[id];
        if (before === undefined || !canRun(before.status)) return;
        if (before.status !== "ready" && !(await openSession(id))) return;
        const current = get().consoles[id];
        const client = clients.get(id);
        if (current?.sessionId == null || current.status !== "ready" || client === undefined) return;
        const { sessionId, sql, result: previous } = current;
        const startedAt = dependencies.now();
        patch(id, { status: "running", error: null });
        const finished = (outcome: RunOutcome): LastRun => ({ durationMs: dependencies.now() - startedAt, outcome });
        try {
          const executed = await client.call("statement.execute", { sessionId, sql });
          requested.get(id)?.clear();
          if (previous !== null) void client.call("result.release", { handle: previous.handle }).catch(() => undefined);
          const { firstWindow, ...result } = executed;
          patch(id, {
            status: "ready",
            result,
            windows: { [firstWindow.offset]: firstWindow.rows },
            lastRun: finished("succeeded"),
          });
        } catch (cause) {
          const error = toError(cause);
          const latest = get().consoles[id];
          patch(id, {
            // A detach while running already said the session is gone, and why.
            status: latest?.status === "disconnected" || latest?.status === "failed" ? latest.status : "ready",
            error,
            lastRun: finished(error.code === "cancelled" ? "cancelled" : "failed"),
          });
        }
      },

      async cancel(id) {
        const current = get().consoles[id];
        const client = clients.get(id);
        if (current?.sessionId == null || current.status !== "running" || client === undefined) return;
        try {
          await client.call("statement.cancel", { sessionId: current.sessionId });
        } catch (cause) {
          patch(id, { error: toError(cause) });
        }
      },

      ensureWindow(id, offset) {
        const current = get().consoles[id];
        const client = clients.get(id);
        if (current?.result == null || client === undefined || offset in current.windows) return;
        const inFlight = requested.get(id) ?? new Set<number>();
        requested.set(id, inFlight);
        if (inFlight.has(offset)) return;
        inFlight.add(offset);
        const { handle } = current.result;
        client
          .call("result.window", { handle, offset, limit: RESULT_WINDOW_ROWS })
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

export const useConsoles = createConsolesStore({
  connect: (datasourceId) => useDatasources.getState().connect(datasourceId),
  now: () => performance.now(),
});

/** The consoles open on a datasource, by console id. */
export function consolesOf(consoles: ConsolesState["consoles"], datasourceId: string): readonly string[] {
  return Object.entries(consoles)
    .filter(([, session]) => session.datasourceId === datasourceId)
    .map(([id]) => id);
}
