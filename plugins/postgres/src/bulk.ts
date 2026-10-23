import type { Column, InferredColumn, InsertRow } from "@table-craft/plugin-api";

const COPY_NULL = "\\N";
const COPY_ESCAPES: ReadonlyMap<string, string> = new Map([
  ["\\", "\\\\"],
  ["\t", "\\t"],
  ["\n", "\\n"],
  ["\r", "\\r"],
]);
const COPY_SPECIAL = /[\\\t\n\r]/gu;
/** How the exporter writes bytes (`cellText`): `0x` and lower-case hex. */
const EXPORTED_BYTES = /^0x([0-9a-fA-F]*)$/u;
const BINARY_TYPES = new Set(["bytea"]);

export const POSTGRES_IMPORT_TYPES = {
  boolean: "boolean",
  integer: "integer",
  bigint: "bigint",
  double: "double precision",
  date: "date",
  timestamp: "timestamp",
  text: "text",
} as const;

/** `numeric` without a typmod takes any precision, so the sample's digits never cut a later row. */
export function postgresDecimal(_column: InferredColumn): string {
  return "numeric";
}

/** Text the server's input function reads for `type`: the exporter's `0x…` becomes bytea's `\x…`. */
function serverText(text: string, type: string | null): string {
  if (type !== null && BINARY_TYPES.has(type)) {
    const hex = EXPORTED_BYTES.exec(text);
    if (hex !== null) return `\\x${hex[1] ?? ""}`;
  }
  return text;
}

/** One row of `COPY … FROM STDIN` in text format: tab-separated, backslash-escaped, `\N` for NULL. */
export function copyLine(row: InsertRow, columns: readonly Column[]): string {
  const cells = row.map((value, index) =>
    value === null
      ? COPY_NULL
      : serverText(value, columns[index]?.type ?? null).replace(COPY_SPECIAL, (char) => COPY_ESCAPES.get(char) ?? char),
  );
  return `${cells.join("\t")}\n`;
}
