import type { Column, Row } from "@table-craft/desktop/engine/protocol.js";
import { formatCell } from "@table-craft/desktop/renderer/grid/format.js";

const MIN_COLUMN_CHARS = 4;
const CELL_BORDER = "1px";
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
 * Width of each column in characters: the longest of its name and its cells in `sample`. The
 * sample is the first window, so later rows never reflow the grid while scrolling.
 */
export function columnChars(columns: readonly Column[], sample: readonly Row[]): number[] {
  return columns.map((column, index) =>
    sample.reduce(
      (widest, row) => Math.max(widest, displayChars(formatCell(row[index] ?? null))),
      Math.max(MIN_COLUMN_CHARS, displayChars(column.name)),
    ),
  );
}

/** A CSS grid track list sizing each column to its characters, capped by the density token. */
export function columnTemplate(chars: readonly number[]): string {
  return chars
    .map((count) => `min(var(--spacing-column-max), calc(${count}ch + 2 * var(--spacing-cell) + ${CELL_BORDER}))`)
    .join(" ");
}
