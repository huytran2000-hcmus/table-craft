import type { Row, WireValue } from "@table-craft/plugin-api";
import type { TypeClass } from "@table-craft/core/results/compare.js";
import { cellText } from "@table-craft/core/results/extract/text.js";

/** What the grid's find bar looks for (decision 050). */
export interface FindQuery {
  readonly text: string;
  readonly caseSensitive: boolean;
  /** `text` is a JavaScript regular expression. */
  readonly regex: boolean;
  /** The whole cell must match, not a part of it. */
  readonly wholeCell: boolean;
}

/** A local quick filter on one column; `text` is the database's own text of the value it was made from. */
export type FilterChip =
  | { readonly column: number; readonly op: "equals" | "notEquals"; readonly text: string }
  | { readonly column: number; readonly op: "isNull" | "isNotNull" };

export type FilterOp = FilterChip["op"];

/** The grid's display preferences find matches against (decision 032). */
export interface DisplayFormats {
  readonly groupDigits: boolean;
}

/** Which rows a result shows and which of their cells the find bar marks. */
export interface ViewSpec {
  readonly find: FindQuery | null;
  /** Hide the rows with no find match ("Filter rows"). */
  readonly rowsOnly: boolean;
  readonly filters: readonly FilterChip[];
  /** The columns the grid draws, in drawing order: only they are searched, and matches run along them. */
  readonly columns: readonly number[];
  readonly formats: DisplayFormats;
}

export interface ViewState {
  /** Rows the view shows. */
  readonly shown: number;
  /** Some rows are hidden; `sources` then maps each shown row to its position among the held rows. */
  readonly filtered: boolean;
  readonly sources: readonly number[] | null;
  /** Cells the find query matches. */
  readonly matches: number;
  /** The find query's regular expression does not compile; it then matches nothing and hides nothing. */
  readonly error: string | null;
}

/** A matched cell: `index` is its place among all matches, `row` a shown row. */
export interface FoundMatch {
  readonly index: number;
  readonly row: number;
  readonly column: number;
}

export interface CellPosition {
  readonly row: number;
  readonly column: number;
}

/** A computed view over the held rows: positions in held order and match keys `row * columns + position`. */
export interface ComputedView {
  readonly sources: readonly number[] | null;
  readonly keys: readonly number[];
  readonly columns: readonly number[];
  readonly error: string | null;
}

const GROUPED_CLASSES: ReadonlySet<TypeClass> = new Set(["integer", "decimal", "float"]);
/** The renderer's `groupDigits` (grid/format.ts), restated so find matches what the grid draws. */
const PLAIN_NUMBER = /^(-?)(\d+)(\.\d+)?$/;
const DIGIT_GROUP = /\B(?=(\d{3})+(?!\d))/g;
const GROUP_SEPARATOR = ",";
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

function grouped(text: string): string {
  const match = PLAIN_NUMBER.exec(text);
  if (match === null) return text;
  const [, sign = "", whole = "", fraction = ""] = match;
  return `${sign}${whole.replace(DIGIT_GROUP, GROUP_SEPARATOR)}${fraction}`;
}

/** A non-null cell as the grid draws it: the renderer's `formatCell` for the same formats. */
export function displayText(value: Exclude<WireValue, null>, typeClass: TypeClass, formats: DisplayFormats): string {
  const text = cellText(value);
  return formats.groupDigits && GROUPED_CLASSES.has(typeClass) ? grouped(text) : text;
}

/** The test a cell's display text must pass, or the reason the query has none. */
export function findMatcher(
  query: FindQuery,
): { readonly test: (text: string) => boolean } | { readonly error: string } {
  const source = query.regex ? query.text : query.text.replace(REGEX_SPECIALS, "\\$&");
  try {
    const pattern = new RegExp(query.wholeCell ? `^(?:${source})$` : source, query.caseSensitive ? "u" : "iu");
    return { test: (text) => pattern.test(text) };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    // V8 says `Invalid regular expression: /<pattern>/<flags>: <reason>`; the pattern is our
    // wrapped one, so only the reason is the user's.
    return { error: message.slice(message.lastIndexOf(": ") + 2) };
  }
}

function keeps(chip: FilterChip, value: WireValue): boolean {
  switch (chip.op) {
    case "isNull":
      return value === null;
    case "isNotNull":
      return value !== null;
    case "equals":
      return value !== null && cellText(value) === chip.text;
    case "notEquals":
      return value === null || cellText(value) !== chip.text;
  }
}

/** Whether `spec` changes anything a plain window would show. */
export function viewActive(spec: ViewSpec | null): spec is ViewSpec {
  return spec !== null && (spec.filters.length > 0 || (spec.find !== null && spec.find.text !== ""));
}

/**
 * One pass over the held rows in display order (`order`, or held order when null): drops the
 * rows a chip or "Filter rows" hides and records every cell the find query matches. Null cells
 * never match a find; the chips "Is NULL" and "Is not NULL" are how to look for them.
 */
export function computeView(
  rows: readonly Row[],
  order: readonly number[] | null,
  classes: readonly TypeClass[],
  spec: ViewSpec,
): ComputedView {
  const find = spec.find !== null && spec.find.text !== "" ? findMatcher(spec.find) : null;
  const error = find !== null && "error" in find ? find.error : null;
  const test = find !== null && "test" in find ? find.test : null;
  const hidesUnmatched = spec.rowsOnly && test !== null;
  const filtered = spec.filters.length > 0 || hidesUnmatched;
  const { columns, formats } = spec;
  const width = columns.length;
  const sources: number[] = [];
  const keys: number[] = [];
  const total = order?.length ?? rows.length;
  for (let position = 0; position < total; position++) {
    const source = order === null ? position : (order[position] as number);
    const row = rows[source] as Row;
    if (!spec.filters.every((chip) => keeps(chip, row[chip.column] ?? null))) continue;
    const shownRow = filtered ? sources.length : position;
    let matched = false;
    if (test !== null) {
      for (let drawn = 0; drawn < width; drawn++) {
        const column = columns[drawn] as number;
        const value = row[column] ?? null;
        if (value === null || !test(displayText(value, classes[column] ?? "text", formats))) continue;
        keys.push(shownRow * width + drawn);
        matched = true;
      }
    }
    if (hidesUnmatched && !matched) continue;
    if (filtered) sources.push(source);
  }
  return { sources: filtered ? sources : null, keys, columns, error };
}

export function viewState(view: ComputedView, heldRows: number): ViewState {
  return {
    shown: view.sources?.length ?? heldRows,
    filtered: view.sources !== null,
    sources: view.sources,
    matches: view.keys.length,
    error: view.error,
  };
}

/** The first index in sorted `keys` whose key is at least `key`. */
function lowerBound(keys: readonly number[], key: number): number {
  let low = 0;
  let high = keys.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((keys[middle] as number) < key) low = middle + 1;
    else high = middle;
  }
  return low;
}

function matchAt(view: ComputedView, index: number): FoundMatch {
  const key = view.keys[index] as number;
  const width = view.columns.length;
  return { index, row: Math.floor(key / width), column: view.columns[key % width] as number };
}

/** Matched cells in shown rows `[offset, offset + count)` as flat `row, column` pairs. */
export function matchesIn(view: ComputedView, offset: number, count: number): number[] {
  const width = view.columns.length;
  if (width === 0) return [];
  const pairs: number[] = [];
  const end = lowerBound(view.keys, (offset + count) * width);
  for (let index = lowerBound(view.keys, offset * width); index < end; index++) {
    const match = matchAt(view, index);
    pairs.push(match.row, match.column);
  }
  return pairs;
}

/**
 * The match after `from` (before it, `backward`), wrapping at either end; from no cell, the first
 * or the last. A `from` column the grid does not draw counts as the row's start.
 */
export function nextMatch(view: ComputedView, from: CellPosition | null, backward: boolean): FoundMatch | null {
  const { keys } = view;
  if (keys.length === 0) return null;
  if (from === null) return matchAt(view, backward ? keys.length - 1 : 0);
  const width = view.columns.length;
  const drawn = Math.max(0, view.columns.indexOf(from.column));
  const key = from.row * width + drawn;
  if (backward) {
    const before = lowerBound(keys, key) - 1;
    return matchAt(view, before >= 0 ? before : keys.length - 1);
  }
  const after = lowerBound(keys, key + 1);
  return matchAt(view, after < keys.length ? after : 0);
}
