import type { Column, Row } from "@table-craft/plugin-api";
import { cellText } from "@table-craft/core/results/extract/text.js";
import type { RowWriter } from "@table-craft/core/results/extract/writer.js";

const ESCAPES: ReadonlyMap<string, string> = new Map([
  ["\\", "\\\\"],
  ["\t", "\\t"],
  ["\n", "\\n"],
  ["\r", "\\r"],
]);

/** Tabs and line breaks would end the field or row, so they are written as `\t`, `\n` and `\r`. */
function field(text: string): string {
  return text.replace(/[\\\t\n\r]/gu, (char) => ESCAPES.get(char) ?? char);
}

function line(cells: readonly string[]): string {
  return `${cells.map(field).join("\t")}\n`;
}

export function tsvWriter(columns: readonly Column[]): RowWriter {
  return {
    start: () => line(columns.map((column) => column.name)),
    row: (row: Row) => line(row.map((value) => (value === null ? "" : cellText(value)))),
    end: () => "",
  };
}
