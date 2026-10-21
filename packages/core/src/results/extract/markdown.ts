import type { Column, Row } from "@table-craft/plugin-api";
import { cellText } from "@table-craft/core/results/extract/text.js";
import type { RowWriter } from "@table-craft/core/results/extract/writer.js";

/** A pipe would end the cell and a line break the row; a backslash is escaped so `\|` stays literal. */
function cell(text: string): string {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replace(/\r?\n|\r/gu, "<br>");
}

function line(cells: readonly string[]): string {
  return `| ${cells.map(cell).join(" | ")} |\n`;
}

export function markdownWriter(columns: readonly Column[]): RowWriter {
  return {
    start: () => line(columns.map((column) => column.name)) + `|${columns.map(() => " --- |").join("")}\n`,
    row: (row: Row) => line(row.map((value) => (value === null ? "" : cellText(value)))),
    end: () => "",
  };
}
