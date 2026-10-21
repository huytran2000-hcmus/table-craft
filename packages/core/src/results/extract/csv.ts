import type { Column, Row } from "@table-craft/plugin-api";
import { cellText } from "@table-craft/core/results/extract/text.js";
import type { RowWriter } from "@table-craft/core/results/extract/writer.js";

const NEEDS_QUOTES = /[",\r\n]/u;

/** RFC 4180: a field holding a comma, quote or line break is quoted, its quotes doubled. NULL is empty. */
function field(text: string): string {
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function line(cells: readonly string[]): string {
  return `${cells.map(field).join(",")}\n`;
}

export function csvWriter(columns: readonly Column[]): RowWriter {
  return {
    start: () => line(columns.map((column) => column.name)),
    row: (row: Row) => line(row.map((value) => (value === null ? "" : cellText(value)))),
    end: () => "",
  };
}
