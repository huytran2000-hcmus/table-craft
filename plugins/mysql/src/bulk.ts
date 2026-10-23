import type { Column, InferredColumn, InsertRow } from "@table-craft/plugin-api";

/** How the exporter writes bytes (`cellText`): `0x` and hex. */
const EXPORTED_BYTES = /^0x([0-9a-fA-F]*)$/u;
const BINARY_TYPE = /^(?:var)?binary\b|blob$/iu;
/** `BOOLEAN` is `tinyint(1)`; the grid reads it as true/false, so the export writes it so. */
const BOOLEAN_TYPE = /^(?:tinyint\(1\)|bool(?:ean)?)(?:\s|$)/iu;
const BOOLEAN_TEXT: ReadonlyMap<string, string> = new Map([
  ["true", "1"],
  ["false", "0"],
]);
/** DECIMAL's ceiling in MySQL: 65 digits, 30 after the point. */
const DECIMAL_MAX_PRECISION = 65;
const DECIMAL_MAX_SCALE = 30;
/** Integer digits a proposed DECIMAL keeps at least, so a later row a little wider than the sample still fits. */
const DECIMAL_MIN_INTEGER_DIGITS = 18;

export const MYSQL_IMPORT_TYPES = {
  boolean: "BOOLEAN",
  integer: "INT",
  bigint: "BIGINT",
  double: "DOUBLE",
  date: "DATE",
  timestamp: "DATETIME(6)",
  text: "TEXT",
} as const;

/** MySQL's bare DECIMAL is DECIMAL(10,0), which would round every fraction away. */
export function mysqlDecimal(column: InferredColumn): string {
  const scale = Math.min(DECIMAL_MAX_SCALE, column.scale);
  const integerDigits = Math.max(DECIMAL_MIN_INTEGER_DIGITS, column.integerDigits);
  const precision = Math.min(DECIMAL_MAX_PRECISION, integerDigits + scale);
  return `DECIMAL(${String(precision)},${String(scale)})`;
}

/** The value mysql2 escapes for `type`: bytes for the exporter's `0x…` in a binary column, 1/0 for a boolean's text. */
function bound(value: string | null, type: string | null): string | Buffer | null {
  if (value === null || type === null) return value;
  if (BINARY_TYPE.test(type)) {
    const hex = EXPORTED_BYTES.exec(value);
    if (hex !== null) return Buffer.from(hex[1] ?? "", "hex");
  }
  if (BOOLEAN_TYPE.test(type)) return BOOLEAN_TEXT.get(value.toLowerCase()) ?? value;
  return value;
}

/** One multi-row INSERT: placeholders in the text, values beside it for the driver to escape. */
export function insertStatement(
  table: string,
  columns: readonly Column[],
  quoteIdentifier: (name: string) => string,
  rows: readonly InsertRow[],
): { readonly sql: string; readonly values: (string | Buffer | null)[] } {
  const tuple = `(${columns.map(() => "?").join(", ")})`;
  const values: (string | Buffer | null)[] = [];
  for (const row of rows) row.forEach((value, index) => values.push(bound(value, columns[index]?.type ?? null)));
  const names = columns.map((column) => quoteIdentifier(column.name)).join(", ");
  return { sql: `INSERT INTO ${table} (${names}) VALUES ${rows.map(() => tuple).join(", ")}`, values };
}
