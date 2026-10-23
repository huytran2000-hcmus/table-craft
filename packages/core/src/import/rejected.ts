import type { CsvRecord } from "@table-craft/core/import/csv.js";

/** Appended to the rejected file's header, after the file's own column names. */
export const REJECTED_COLUMNS = ["rejected_line", "rejected_reason"] as const;
/** What `<file>` becomes beside it: `orders.csv` → `orders.csv.rejected.csv` (plan 021, ruling 12). */
export const REJECTED_SUFFIX = ".rejected.csv";

const NEEDS_QUOTES = /[",\r\n]/u;

/** The exporter's CSV field (`results/extract/csv.ts`), so the rejected file imports back with the CSV preset. */
function field(text: string | null): string {
  if (text === null) return "";
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function line(cells: readonly (string | null)[]): string {
  return `${cells.map(field).join(",")}\n`;
}

export function rejectedHeader(names: readonly string[]): string {
  return line([...names, ...REJECTED_COLUMNS]);
}

/** The record as read, then where it stood and why it was refused. */
export function rejectedLine(record: CsvRecord, reason: string): string {
  return line([...record.fields, String(record.line), reason]);
}

export function rejectedPathOf(path: string): string {
  return `${path}${REJECTED_SUFFIX}`;
}
