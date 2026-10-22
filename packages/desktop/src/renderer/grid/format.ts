import type { WireValue } from "@table-craft/desktop/engine/protocol.js";

export const NULL_TEXT = "<null>";
/** A table editor cell that will take its column's default when submitted. */
export const DEFAULT_TEXT = "<default>";
const HEX_PREFIX = "0x";
const ELLIPSIS = "…";
const HEX_DIGITS_PER_BYTE = 2;

/** How a cell reads in the grid. Never parses `json` or `date`: the engine already rendered them. */
export function formatCell(value: WireValue): string {
  if (value === null) return NULL_TEXT;
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
