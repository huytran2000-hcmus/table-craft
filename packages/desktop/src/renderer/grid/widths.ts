import type { Column, Row, TypeClass } from "@table-craft/desktop/engine/protocol.js";
import { formatCell, RAW_FORMATS, type CellFormats } from "@table-craft/desktop/renderer/grid/format.js";

const MIN_COLUMN_CHARS = 4;
/**
 * Characters a monospace font draws two cells wide: CJK, Hangul, fullwidth forms and emoji
 * (Unicode East Asian Width W/F, approximated by script and the emoji property).
 */
const WIDE_CHARACTER =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Extended_Pictographic}\u3000-\u303F\uFF01-\uFF60\uFFE0-\uFFE6]/u;
const WIDE_CHARS = 2;

/** How many `ch` a monospace font needs for `text`. */
export function displayChars(text: string): number {
  let width = 0;
  for (const character of text) width += WIDE_CHARACTER.test(character) ? WIDE_CHARS : 1;
  return width;
}

/**
 * Room in `ch` the header takes beside the name: the type glyph and, once sorted, the sort arrow
 * and key number, each an icon of about two `ch` plus a gap.
 */
export const HEADER_EXTRA_CHARS = 7;

/** Width of each column in characters: the longest of its header and its cells in `sample`. */
export function columnChars(
  columns: readonly Column[],
  sample: readonly Row[],
  typeClasses: readonly TypeClass[] = [],
  formats: CellFormats = RAW_FORMATS,
): number[] {
  return columns.map((column, index) =>
    sample.reduce(
      (widest, row) => Math.max(widest, displayChars(formatCell(row[index] ?? null, typeClasses[index], formats))),
      Math.max(MIN_COLUMN_CHARS, displayChars(column.name) + HEADER_EXTRA_CHARS),
    ),
  );
}

/**
 * `chars` widened to fit the cells of `rows`, the same array when nothing grew. Columns only grow,
 * so a later window reflows the grid at most when a value is wider than any before it; a number
 * clipped to `49…` misleads more than one reflow.
 */
export function widerChars(
  chars: readonly number[],
  rows: readonly Row[],
  typeClasses: readonly TypeClass[] = [],
  formats: CellFormats = RAW_FORMATS,
): readonly number[] {
  let grown: number[] | null = null;
  for (const row of rows) {
    for (const [index, current] of (grown ?? chars).entries()) {
      const width = displayChars(formatCell(row[index] ?? null, typeClasses[index], formats));
      if (width > current) {
        grown ??= [...chars];
        grown[index] = width;
      }
    }
  }
  return grown ?? chars;
}
