import type { TypeClass, WireValue } from "@table-craft/desktop/engine/protocol.js";

export const NULL_TEXT = "<null>";
/** A table editor cell that will take its column's default when submitted. */
export const DEFAULT_TEXT = "<default>";
const HEX_PREFIX = "0x";
const ELLIPSIS = "…";
const HEX_DIGITS_PER_BYTE = 2;

/** The display preferences of the Data Editor settings page (decision 032: display only). */
export interface CellFormats {
  readonly nullText: string;
  readonly groupDigits: boolean;
}

/** The database's own text: what copy, export, filters, the editor's input and history use. */
export const RAW_FORMATS: CellFormats = { nullText: NULL_TEXT, groupDigits: false };

const GROUPED_CLASSES: ReadonlySet<TypeClass> = new Set(["integer", "decimal", "float"]);
/** Only plain decimal text is grouped; exponents, `NaN` and `Infinity` are drawn as printed. */
const PLAIN_NUMBER = /^(-?)(\d+)(\.\d+)?$/;
const DIGIT_GROUP = /\B(?=(\d{3})+(?!\d))/g;
const GROUP_SEPARATOR = ",";

/** `text` with a comma every three digits of its integer part, when it is a plain number. */
export function groupDigits(text: string): string {
  const match = PLAIN_NUMBER.exec(text);
  if (match === null) return text;
  const [, sign = "", whole = "", fraction = ""] = match;
  return `${sign}${whole.replace(DIGIT_GROUP, GROUP_SEPARATOR)}${fraction}`;
}

/**
 * How a cell reads in the grid. Never parses `json` or `date`: the engine already rendered them.
 * Without `formats` it is the database's text; the grid draws and measures with the same call.
 */
export function formatCell(
  value: WireValue,
  typeClass: TypeClass = "text",
  formats: CellFormats = RAW_FORMATS,
): string {
  if (value === null) return formats.nullText;
  const text = rawText(value);
  return formats.groupDigits && GROUPED_CLASSES.has(typeClass) ? groupDigits(text) : text;
}

function rawText(value: Exclude<WireValue, null>): string {
  if (typeof value !== "object") return String(value);
  switch (value.kind) {
    case "bigint":
      return value.value;
    case "bytes": {
      const clipped = value.preview.length / HEX_DIGITS_PER_BYTE < value.length;
      return `${HEX_PREFIX}${value.preview}${clipped ? ELLIPSIS : ""}`;
    }
    case "json":
      return value.text;
    case "date":
      return value.iso;
  }
}

const BYTES_PER_HEX_LINE = 16;
const COUNT_FORMAT = new Intl.NumberFormat("en-US");

/** What the value panel shows for a cell (plan 007 decision 15). */
export type PanelValue =
  | { readonly kind: "null" }
  | { readonly kind: "json"; readonly text: string }
  | { readonly kind: "bytes"; readonly hex: string; readonly note: string }
  | { readonly kind: "text"; readonly text: string };

/** The bytes preview as spaced hex, sixteen bytes a line. */
export function hexLines(preview: string): string {
  const bytes = preview.match(/.{1,2}/g) ?? [];
  const lines: string[] = [];
  for (let index = 0; index < bytes.length; index += BYTES_PER_HEX_LINE) {
    lines.push(bytes.slice(index, index + BYTES_PER_HEX_LINE).join(" "));
  }
  return lines.join("\n");
}

/** `32 of 2,048 bytes shown` when the engine sent a preview, `4 bytes` when it sent them all. */
export function bytesNote(preview: string, length: number): string {
  const shown = preview.length / HEX_DIGITS_PER_BYTE;
  const total = COUNT_FORMAT.format(length);
  if (shown < length) return `${COUNT_FORMAT.format(shown)} of ${total} bytes shown`;
  return length === 1 ? "1 byte" : `${total} bytes`;
}

export function panelValue(value: WireValue): PanelValue {
  if (value === null) return { kind: "null" };
  if (typeof value === "object") {
    if (value.kind === "json") return { kind: "json", text: value.text };
    if (value.kind === "bytes")
      return { kind: "bytes", hex: hexLines(value.preview), note: bytesNote(value.preview, value.length) };
  }
  return { kind: "text", text: formatCell(value) };
}
