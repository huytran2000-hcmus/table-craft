import type { SortDirection, SortKey } from "@table-craft/desktop/engine/protocol.js";

const NEXT: Record<SortDirection | "none", SortDirection | null> = { none: "asc", asc: "desc", desc: null };

/**
 * The sort after a header click (plan 007 decision 5): ascending, descending, then none. A plain
 * click sorts by that column alone; `add` (⌥-click) keeps the other keys and cycles this one in
 * place, appending it as the next key when it was not one.
 */
export function cycledSort(keys: readonly SortKey[], column: number, add: boolean): readonly SortKey[] {
  const current = keys.find((key) => key.column === column)?.direction ?? "none";
  const next = NEXT[current];
  if (!add) return next === null ? [] : [{ column, direction: next }];
  if (next === null) return keys.filter((key) => key.column !== column);
  if (current === "none") return [...keys, { column, direction: next }];
  return keys.map((key) => (key.column === column ? { column, direction: next } : key));
}

/** The sort the header menu's Sort Ascending and Sort Descending set: that column alone. */
export function sortedBy(column: number, direction: SortDirection): readonly SortKey[] {
  return [{ column, direction }];
}

/** The key on `column` and its 1-based number, for the header's arrow and, with several keys, its number. */
export function sortMarkOf(
  keys: readonly SortKey[],
  column: number,
): { readonly direction: SortDirection; readonly position: number } | null {
  const index = keys.findIndex((key) => key.column === column);
  const key = keys[index];
  return key === undefined ? null : { direction: key.direction, position: index + 1 };
}
