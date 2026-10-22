import {
  RESULT_WINDOW_ROWS,
  type EngineError,
  type ExportedResult,
  type ExtractorKind,
  type ResultState,
  type RowRange,
} from "@table-craft/desktop/engine/protocol.js";
import { EngineRequestError, type EngineClient } from "@table-craft/desktop/renderer/engine/client.js";
import { widerChars } from "@table-craft/desktop/renderer/grid/widths.js";
import { withWindow, type ResultTab } from "@table-craft/desktop/renderer/state/resultTab.js";

const UNEXPECTED_HINT = "Restart the app; if it happens again, report it.";

export function toError(cause: unknown): EngineError {
  if (cause instanceof EngineRequestError) return { code: cause.code, message: cause.message, hint: cause.hint };
  return { code: "internal", message: cause instanceof Error ? cause.message : String(cause), hint: UNEXPECTED_HINT };
}

/** How a store that owns result tabs lets the shared window logic reach them. */
export interface ResultOwner {
  readonly client: (ownerId: string) => EngineClient | undefined;
  readonly result: (ownerId: string, resultId: string) => ResultTab | undefined;
  readonly update: (ownerId: string, resultId: string, change: (result: ResultTab) => ResultTab) => void;
  /** A request about `result` failed; `window` when it was a scroll's window load. */
  readonly failed: (ownerId: string, result: ResultTab, error: EngineError, window: boolean) => void;
}

/** Whether Fetch Next Page and Fetch All can run on the tab. */
export function canFetch(result: ResultTab): boolean {
  return result.cursorOpen && !result.stale && result.fetching === null;
}

/**
 * Windows, fetching, copy and export for result tabs held in the engine (plan 007), shared by
 * consoles and table tabs so both page and evict the same way.
 */
export function createResultWindows(owner: ResultOwner) {
  /** Window requests in flight per result tab. */
  const requested = new Map<string, Set<number>>();
  /** Bumped when a tab's loaded windows stop matching the engine's order; older answers are dropped. */
  const generations = new Map<string, number>();

  /** Loaded windows no longer match the engine's order: drop them, and any answer still on its way. */
  function invalidate(resultId: string): void {
    generations.set(resultId, (generations.get(resultId) ?? 0) + 1);
    requested.delete(resultId);
  }

  function forget(resultId: string): void {
    requested.delete(resultId);
    generations.delete(resultId);
  }

  /** `result` after the engine reported `state`; rows that moved are fetched again as they show. */
  function withState(result: ResultTab, state: ResultState): ResultTab {
    if (state.rowCount === result.rowCount) return { ...result, ...state };
    invalidate(result.id);
    const windows =
      result.sort.length > 0
        ? {}
        : Object.fromEntries(Object.entries(result.windows).filter(([, rows]) => rows.length === RESULT_WINDOW_ROWS));
    return { ...result, ...state, windows };
  }

  function ensureWindow(ownerId: string, resultId: string, offset: number): void {
    const result = owner.result(ownerId, resultId);
    const client = owner.client(ownerId);
    if (result === undefined || client === undefined || result.stale || offset in result.windows) return;
    if (offset >= result.rowCount) return;
    const inFlight = requested.get(resultId) ?? new Set<number>();
    requested.set(resultId, inFlight);
    if (inFlight.has(offset)) return;
    inFlight.add(offset);
    const generation = generations.get(resultId) ?? 0;
    client
      .call("result.window", { handle: result.handle, offset, limit: RESULT_WINDOW_ROWS })
      .then((window) => {
        if ((generations.get(resultId) ?? 0) !== generation) return;
        owner.update(ownerId, resultId, (latest) => ({
          ...latest,
          windows: withWindow(latest.windows, window.offset, window.rows),
          autoChars: widerChars(latest.autoChars, window.rows),
        }));
      })
      .catch((cause: unknown) => {
        if ((generations.get(resultId) ?? 0) === generation) owner.failed(ownerId, result, toError(cause), true);
      })
      .finally(() => inFlight.delete(offset));
  }

  async function fetchMore(ownerId: string, resultId: string, all: boolean): Promise<void> {
    const result = owner.result(ownerId, resultId);
    const client = owner.client(ownerId);
    if (result === undefined || client === undefined || !canFetch(result)) return;
    owner.update(ownerId, resultId, (latest) => ({ ...latest, fetching: all ? "all" : "page" }));
    try {
      const state = await client.call("result.fetchMore", { handle: result.handle, all });
      owner.update(ownerId, resultId, (latest) => withState(latest, state));
    } catch (cause) {
      owner.failed(ownerId, result, toError(cause), false);
      owner.update(ownerId, resultId, (latest) => ({ ...latest, cursorOpen: false }));
    } finally {
      owner.update(ownerId, resultId, (latest) => ({ ...latest, fetching: null }));
    }
  }

  async function stopFetch(ownerId: string, resultId: string): Promise<void> {
    const result = owner.result(ownerId, resultId);
    const client = owner.client(ownerId);
    if (result === undefined || client === undefined || (result.fetching !== "page" && result.fetching !== "all")) {
      return;
    }
    try {
      await client.call("result.stopFetch", { handle: result.handle });
    } catch (cause) {
      owner.failed(ownerId, result, toError(cause), false);
    }
  }

  async function extract(
    ownerId: string,
    resultId: string,
    extractor: ExtractorKind,
    rows: readonly RowRange[],
    columns: readonly number[],
  ): Promise<string | null> {
    const result = owner.result(ownerId, resultId);
    const client = owner.client(ownerId);
    if (result === undefined || client === undefined || result.stale) return null;
    try {
      return await client.call("result.extract", {
        handle: result.handle,
        extractor,
        rows: [...rows],
        columns: [...columns],
      });
    } catch (cause) {
      owner.failed(ownerId, result, toError(cause), false);
      return null;
    }
  }

  /** Writes the result to `path`, draining its open cursor; null when it could not. */
  async function exportTo(
    ownerId: string,
    resultId: string,
    extractor: ExtractorKind,
    path: string,
    columns: readonly number[],
  ): Promise<ExportedResult | null> {
    const result = owner.result(ownerId, resultId);
    const client = owner.client(ownerId);
    if (result === undefined || client === undefined || result.stale || result.fetching !== null) return null;
    owner.update(ownerId, resultId, (latest) => ({ ...latest, fetching: "export" }));
    try {
      const exported = await client.call("result.export", {
        handle: result.handle,
        extractor,
        path,
        columns: [...columns],
      });
      // The export drained the cursor into the file.
      owner.update(ownerId, resultId, (latest) => ({ ...latest, cursorOpen: false }));
      return exported;
    } catch (cause) {
      owner.failed(ownerId, result, toError(cause), false);
      return null;
    } finally {
      owner.update(ownerId, resultId, (latest) => ({ ...latest, fetching: null }));
    }
  }

  return { invalidate, forget, withState, ensureWindow, fetchMore, stopFetch, extract, exportTo };
}

export type ResultWindows = ReturnType<typeof createResultWindows>;
