import type { Column, Row, WireValue } from "@table-craft/plugin-api";
import { bytesText } from "@table-craft/core/results/extract/text.js";
import type { RowWriter } from "@table-craft/core/results/extract/writer.js";

const INDENT = 2;

/** JSON columns embed as JSON; integers past 2^53 and decimals stay strings so no digit is lost. */
function jsonValue(value: WireValue): unknown {
  if (value === null || typeof value !== "object") return value;
  switch (value.kind) {
    case "bigint":
      return value.value;
    case "json":
      try {
        return JSON.parse(value.text) as unknown;
      } catch {
        return value.text;
      }
    case "date":
      return value.iso;
    case "bytes":
      return bytesText(value.preview, value.length);
  }
}

function indented(text: string): string {
  return text.replaceAll("\n", `\n${" ".repeat(INDENT)}`);
}

/** An array of objects keyed by column name; with a repeated name the last column wins. */
export function jsonWriter(columns: readonly Column[]): RowWriter {
  return {
    start: () => "[",
    row: (row: Row, index: number) => {
      const object = Object.fromEntries(columns.map((column, at) => [column.name, jsonValue(row[at] ?? null)]));
      const separator = index === 0 ? "\n" : ",\n";
      return `${separator}${" ".repeat(INDENT)}${indented(JSON.stringify(object, null, INDENT))}`;
    },
    end: (count: number) => (count === 0 ? "]\n" : "\n]\n"),
  };
}
