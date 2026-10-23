import {
  RESULT_WINDOW_ROWS,
  type EngineError,
  type ExportFormat,
  type ExportTask,
  type ExtractorKind,
  type ResultState,
  type RowRange,
} from "@table-craft/desktop/engine/protocol.js";
import { EngineRequestError, type EngineClient } from "@table-craft/desktop/renderer/engine/client.js";
import { widerChars } from "@table-craft/desktop/renderer/grid/widths.js";
import type { ExportStarter } from "@table-craft/desktop/renderer/state/exports.js";
import { withWindow, type ResultTab } from "@table-craft/desktop/renderer/state/resultTab.js";
import { currentFormats } from "@table-craft/desktop/renderer/state/settings.js";

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
  /** Fetching grew the result to `rowCount` rows, so Services can say so. */
  readonly fetched: (ownerId: string, resultId: string, rowCount: number) => void;
  /** The datasource an owner's session is on, for an export of its result. */
  readonly datasourceOf: (ownerId: string) => string | undefined;
  readonly exports: ExportStarter;
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
          autoChars: widerChars(latest.autoChars, window.rows, latest.typeClasses, currentFormats()),
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
      const state = await client.call("result.fetchMore", { handle: result.handle, all, ...result.paging });
      owner.update(ownerId, resultId, (latest) => withState(latest, state));
      owner.fetched(ownerId, resultId, state.rowCount);
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

  /**
   * Starts a background export of the result (decision 040); null when it could not start. Only
   * an export that drains the console's own cursor keeps the grid busy, until its task ends.
   */
  async function exportTo(
    ownerId: string,
    resultId: string,
    format: ExportFormat,
    path: string,
    columns: readonly number[],
  ): Promise<ExportTask | null> {
    const result = owner.result(ownerId, resultId);
    const datasourceId = owner.datasourceOf(ownerId);
    if (result === undefined || datasourceId === undefined || result.stale || result.fetching !== null) return null;
    try {
      const task = await owner.exports.start(datasourceId, {
        source: { kind: "result", handle: result.handle, columns: [...columns] },
        format,
        path,
      });
      if (task.origin === "cursor") {
        owner.update(ownerId, resultId, (latest) => ({ ...latest, fetching: "export" }));
        void owner.exports.finished(task.taskId).then(() => {
          owner.update(ownerId, resultId, (latest) => ({ ...latest, fetching: null, cursorOpen: false }));
        });
      }
      return task;
    } catch (cause) {
      owner.failed(ownerId, result, toError(cause), false);
      return null;
    }
  }

  return { invalidate, forget, withState, ensureWindow, fetchMore, stopFetch, extract, exportTo };
}

export type ResultWindows = ReturnType<typeof createResultWindows>;
