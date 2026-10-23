import type { CellInput, RowEdit, WireValue } from "@table-craft/desktop/engine/protocol.js";
import { formatCell } from "@table-craft/desktop/renderer/grid/format.js";

/** A row added since the last submit; `id` stays fixed while rows before it come and go. */
export interface InsertedRow {
  readonly id: number;
  readonly values: readonly CellInput[];
}

/**
 * A table tab's pending changes (plan 008 decision 8). Held rows are named by their index in the
 * engine's result, the same index `RowEdit.row` carries.
 */
export interface EditBuffer {
  readonly updates: ReadonlyMap<number, ReadonlyMap<number, CellInput>>;
  readonly inserts: readonly InsertedRow[];
  readonly deletes: ReadonlySet<number>;
  readonly nextId: number;
}

export const EMPTY_BUFFER: EditBuffer = { updates: new Map(), inserts: [], deletes: new Set(), nextId: 1 };

/** A grid row: one the result holds, or one added after them. */
export type BufferRow =
  { readonly kind: "held"; readonly row: number } | { readonly kind: "inserted"; readonly id: number };

/** A cell named by its grid row and result column. */
export interface BufferCell {
  readonly row: number;
  readonly column: number;
}

/**
 * The held rows the grid draws: all of them, or while a local filter hides some (plan 023) the
 * `count` it shows, `sources` naming each one's index in the result.
 */
export type HeldRows = number | { readonly count: number; readonly sources: readonly number[] };

function heldCount(heldRows: HeldRows): number {
  return typeof heldRows === "number" ? heldRows : heldRows.count;
}

/** Inserted rows draw after the held rows, in the order they were added. */
export function bufferRowAt(buffer: EditBuffer, heldRows: HeldRows, index: number): BufferRow | null {
  if (index < 0) return null;
  const held = heldCount(heldRows);
  if (index < held) {
    const row = typeof heldRows === "number" ? index : heldRows.sources[index];
    return row === undefined ? null : { kind: "held", row };
  }
  const inserted = buffer.inserts[index - held];
  return inserted === undefined ? null : { kind: "inserted", id: inserted.id };
}

export function gridRowCount(buffer: EditBuffer, heldRows: HeldRows): number {
  return heldCount(heldRows) + buffer.inserts.length;
}

/** The input a cell holds in the buffer, or undefined when it shows the value the database sent. */
export function pendingInput(buffer: EditBuffer, row: BufferRow, column: number): CellInput | undefined {
  if (row.kind === "held") return buffer.updates.get(row.row)?.get(column);
  return buffer.inserts.find((inserted) => inserted.id === row.id)?.values[column];
}

export function isDeleted(buffer: EditBuffer, row: BufferRow): boolean {
  return row.kind === "held" && buffer.deletes.has(row.row);
}

/** Writes `input` to a cell; a deleted row takes no edits until it is reverted. */
export function setCell(buffer: EditBuffer, row: BufferRow, column: number, input: CellInput): EditBuffer {
  if (row.kind === "inserted") {
    return {
      ...buffer,
      inserts: buffer.inserts.map((inserted) =>
        inserted.id === row.id
          ? { ...inserted, values: inserted.values.map((value, index) => (index === column ? input : value)) }
          : inserted,
      ),
    };
  }
  if (buffer.deletes.has(row.row)) return buffer;
  const updates = new Map(buffer.updates);
  updates.set(row.row, new Map(updates.get(row.row)).set(column, input));
  return { ...buffer, updates };
}

/** Appends a row whose every column takes its default. */
export function addRow(buffer: EditBuffer, columnCount: number): EditBuffer {
  const values = Array.from({ length: columnCount }, (): CellInput => ({ kind: "default" }));
  return { ...buffer, inserts: [...buffer.inserts, { id: buffer.nextId, values }], nextId: buffer.nextId + 1 };
}

/** A shown value as the input that writes it back; bytes have only a preview, so they take the default. */
export function inputOf(value: WireValue | undefined): CellInput {
  if (value === undefined) return { kind: "default" };
  if (value === null) return { kind: "null" };
  if (typeof value === "object" && value.kind === "bytes") return { kind: "default" };
  return { kind: "text", text: formatCell(value) };
}

/**
 * Appends a copy of each source row (plan 008 decision 12); columns marked in `defaulted`, the
 * identity and auto-increment ones, take their default so the copy gets a key of its own.
 */
export function duplicateRows(
  buffer: EditBuffer,
  sources: readonly (readonly CellInput[])[],
  defaulted: readonly boolean[],
): EditBuffer {
  let next = buffer;
  for (const source of sources) {
    const values = source.map((value, column): CellInput => (defaulted[column] === true ? { kind: "default" } : value));
    next = { ...next, inserts: [...next.inserts, { id: next.nextId, values }], nextId: next.nextId + 1 };
  }
  return next;
}

/** Marks held rows deleted, dropping their edits; an inserted row is dropped outright. */
export function deleteRows(buffer: EditBuffer, rows: readonly BufferRow[]): EditBuffer {
  const dropped = new Set(rows.flatMap((row) => (row.kind === "inserted" ? [row.id] : [])));
  const deletes = new Set(buffer.deletes);
  const updates = new Map(buffer.updates);
  for (const row of rows) {
    if (row.kind !== "held") continue;
    deletes.add(row.row);
    updates.delete(row.row);
  }
  return { ...buffer, updates, deletes, inserts: buffer.inserts.filter((inserted) => !dropped.has(inserted.id)) };
}

/**
 * Undoes what the buffer holds for `cells`: an edited cell goes back to its value, a deleted row
 * comes back, and an inserted row any of whose cells is named is dropped.
 */
export function revertCells(buffer: EditBuffer, heldRows: HeldRows, cells: readonly BufferCell[]): EditBuffer {
  const updates = new Map(buffer.updates);
  const deletes = new Set(buffer.deletes);
  const dropped = new Set<number>();
  for (const cell of cells) {
    const row = bufferRowAt(buffer, heldRows, cell.row);
    if (row === null) continue;
    if (row.kind === "inserted") {
      dropped.add(row.id);
      continue;
    }
    deletes.delete(row.row);
    const edited = updates.get(row.row);
    if (edited === undefined || !edited.has(cell.column)) continue;
    const kept = new Map(edited);
    kept.delete(cell.column);
    if (kept.size === 0) updates.delete(row.row);
    else updates.set(row.row, kept);
  }
  return { ...buffer, updates, deletes, inserts: buffer.inserts.filter((inserted) => !dropped.has(inserted.id)) };
}

/** Rows touched: each edited row, deleted row and inserted row counts once. */
export function pendingCount(buffer: EditBuffer): number {
  return buffer.updates.size + buffer.deletes.size + buffer.inserts.length;
}

export function toEdits(buffer: EditBuffer): RowEdit[] {
  const deletes = [...buffer.deletes].sort((a, b) => a - b).map((row): RowEdit => ({ kind: "delete", row }));
  const updates = [...buffer.updates.entries()]
    .sort(([a], [b]) => a - b)
    .map(([row, cells]): RowEdit => ({
      kind: "update",
      row,
      values: [...cells.entries()].sort(([a], [b]) => a - b).map(([column, value]) => ({ column, value })),
    }));
  const inserts = buffer.inserts.map((inserted): RowEdit => ({ kind: "insert", values: inserted.values }));
  return [...deletes, ...updates, ...inserts];
}

/** `3 pending changes`, or null with none. */
export function pendingText(count: number): string | null {
  if (count === 0) return null;
  return `${String(count)} pending ${count === 1 ? "change" : "changes"}`;
}
