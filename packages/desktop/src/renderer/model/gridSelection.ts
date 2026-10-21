/**
 * The grid's rectangle selection (plan 007 decision 9). Rows are positions in the result's current
 * order, columns positions among the visible columns; `anchor` stays put while `focus` moves.
 */

export interface Cell {
  readonly row: number;
  readonly column: number;
}

export interface GridSelection {
  readonly anchor: Cell;
  readonly focus: Cell;
}

/** How many rows are fetched and how many columns show. */
export interface GridBounds {
  readonly rows: number;
  readonly columns: number;
}

export interface CellRect {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/** What `result.extract` takes: row ranges (`to` exclusive) and result column indices. */
export interface SelectedRanges {
  readonly rows: readonly { readonly from: number; readonly to: number }[];
  readonly columns: readonly number[];
}

function clampCell(cell: Cell, bounds: GridBounds): Cell {
  return {
    row: Math.min(Math.max(cell.row, 0), Math.max(bounds.rows - 1, 0)),
    column: Math.min(Math.max(cell.column, 0), Math.max(bounds.columns - 1, 0)),
  };
}

export function selectCell(cell: Cell): GridSelection {
  return { anchor: cell, focus: cell };
}

/** Shift-click and drag: the anchor stays, the rectangle reaches `cell`. */
export function extendTo(selection: GridSelection, cell: Cell): GridSelection {
  return { anchor: selection.anchor, focus: cell };
}

/** An arrow key: moves the focus, and the anchor with it unless `extend` (Shift). */
export function moveBy(
  selection: GridSelection,
  rows: number,
  columns: number,
  bounds: GridBounds,
  extend: boolean,
): GridSelection {
  const focus = clampCell({ row: selection.focus.row + rows, column: selection.focus.column + columns }, bounds);
  return extend ? { anchor: selection.anchor, focus } : selectCell(focus);
}

/** A row-number click; with `from`, a shift-click extending the earlier row selection. */
export function selectRows(row: number, bounds: GridBounds, from?: number): GridSelection {
  const last = Math.max(bounds.columns - 1, 0);
  return { anchor: { row: from ?? row, column: 0 }, focus: { row, column: last } };
}

/** A ⌘-click on a header: every fetched row of that column. */
export function selectColumn(column: number, bounds: GridBounds): GridSelection {
  return { anchor: { row: 0, column }, focus: { row: Math.max(bounds.rows - 1, 0), column } };
}

export function selectAll(bounds: GridBounds): GridSelection {
  return {
    anchor: { row: 0, column: 0 },
    focus: { row: Math.max(bounds.rows - 1, 0), column: Math.max(bounds.columns - 1, 0) },
  };
}

export function rectOf(selection: GridSelection): CellRect {
  const { anchor, focus } = selection;
  return {
    top: Math.min(anchor.row, focus.row),
    bottom: Math.max(anchor.row, focus.row),
    left: Math.min(anchor.column, focus.column),
    right: Math.max(anchor.column, focus.column),
  };
}

export function contains(rect: CellRect, row: number, column: number): boolean {
  return row >= rect.top && row <= rect.bottom && column >= rect.left && column <= rect.right;
}

export function cellCount(selection: GridSelection): number {
  const rect = rectOf(selection);
  return (rect.bottom - rect.top + 1) * (rect.right - rect.left + 1);
}

export function rowCountOf(selection: GridSelection): number {
  const rect = rectOf(selection);
  return rect.bottom - rect.top + 1;
}

/** The selection as extract ranges, mapping visible positions through `visible` to result columns. */
export function selectedRanges(selection: GridSelection, visible: readonly number[]): SelectedRanges {
  const rect = rectOf(selection);
  return {
    rows: [{ from: rect.top, to: rect.bottom + 1 }],
    columns: visible.slice(rect.left, rect.right + 1),
  };
}

/** The selection kept inside the grid after rows or columns changed, or null when nothing is left. */
export function clampSelection(selection: GridSelection | null, bounds: GridBounds): GridSelection | null {
  if (selection === null || bounds.rows === 0 || bounds.columns === 0) return null;
  return { anchor: clampCell(selection.anchor, bounds), focus: clampCell(selection.focus, bounds) };
}
