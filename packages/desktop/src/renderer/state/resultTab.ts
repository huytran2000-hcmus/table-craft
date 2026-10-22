import {
  RESULT_WINDOW_ROWS,
  type Column,
  type ExecutedStatement,
  type ResultState,
  type Row,
  type SortKey,
  type TypeClass,
} from "@table-craft/desktop/engine/protocol.js";
import { columnChars } from "@table-craft/desktop/renderer/grid/widths.js";
import { initialLayout, type ColumnLayout } from "@table-craft/desktop/renderer/model/columnLayout.js";
import type { GridSelection } from "@table-craft/desktop/renderer/model/gridSelection.js";

/** What the grid is fetching for a result: a page, everything to the cap, or the rest into a file. */
export type ResultFetch = "page" | "all" | "export";

/**
 * A result tab: one row-returning statement's rows, held in the engine behind `handle`. Its
 * layout, sort and selection live here and die with the tab (plan 007 decision 8).
 */
export interface ResultTab extends ResultState {
  readonly id: string;
  /** `Result 1`, `Result 2`…, the first number no pinned tab holds. */
  readonly title: string;
  readonly sql: string;
  readonly handle: string;
  readonly columns: readonly Column[];
  readonly typeClasses: readonly TypeClass[];
  readonly rowsAffected: number | null;
  /** Loaded windows keyed by their offset, a multiple of `RESULT_WINDOW_ROWS`; at most `MAX_LOADED_WINDOWS`. */
  readonly windows: Readonly<Record<number, readonly Row[]>>;
  /** Each column's width in characters from the first page, so scrolling and eviction never reflow it. */
  readonly autoChars: readonly number[];
  readonly sort: readonly SortKey[];
  readonly layout: ColumnLayout;
  readonly selection: GridSelection | null;
  readonly fetching: ResultFetch | null;
  /** Its engine went away: the rows shown are all there will be until a rerun (plan 007 decision 18). */
  readonly stale: boolean;
  /** A pinned tab survives the next run; the others are replaced and their handles released. */
  readonly pinned: boolean;
}

/** The window offset that holds row `index`. */
export function windowOffsetOf(index: number): number {
  return Math.floor(index / RESULT_WINDOW_ROWS) * RESULT_WINDOW_ROWS;
}

export function rowAt(windows: ResultTab["windows"], index: number): Row | undefined {
  const offset = windowOffsetOf(index);
  return windows[offset]?.[index - offset];
}

/** Windows a result tab keeps loaded (plan 007 decision 17); scrolling back refetches the rest. */
export const MAX_LOADED_WINDOWS = 20;

/** `windows` with `rows` at `offset`, dropping the windows furthest from it past `max`. */
export function withWindow(
  windows: ResultTab["windows"],
  offset: number,
  rows: readonly Row[],
  max: number = MAX_LOADED_WINDOWS,
): ResultTab["windows"] {
  const next: Record<number, readonly Row[]> = { ...windows, [offset]: rows };
  const offsets = Object.keys(next).map(Number);
  if (offsets.length <= max) return next;
  const furthest = offsets.sort((a, b) => Math.abs(b - offset) - Math.abs(a - offset)).slice(0, offsets.length - max);
  for (const evicted of furthest) delete next[evicted];
  return next;
}

/** A tab for `executed`, the statement `sql` returned. */
export function resultTabOf(
  executed: Omit<ExecutedStatement, "transactionOpen">,
  ids: { readonly id: string; readonly title: string },
  sql: string,
): ResultTab {
  const { firstWindow, ...summary } = executed;
  return {
    ...summary,
    ...ids,
    sql,
    windows: { [firstWindow.offset]: firstWindow.rows },
    autoChars: columnChars(summary.columns, firstWindow.rows),
    sort: [],
    layout: initialLayout(summary.columns.length),
    selection: null,
    fetching: null,
    stale: false,
    pinned: false,
  };
}
