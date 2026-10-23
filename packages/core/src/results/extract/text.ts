import type { WireValue } from "@table-craft/plugin-api";

const CLIPPED_MARK = "…";
const HEX_DIGITS_PER_BYTE = 2;

/**
 * `0x` and the hex, marked when the preview holds less than the value (decision 017); an export
 * reads values in full, so its hex is never marked (plan 018).
 */
export function bytesText(preview: string, length: number): string {
  return `0x${preview}${preview.length < length * HEX_DIGITS_PER_BYTE ? CLIPPED_MARK : ""}`;
}

/** A non-null cell as the text formats write it: the database's own text where it has one. */
export function cellText(value: Exclude<WireValue, null>): string {
  switch (typeof value) {
    case "boolean":
    case "number":
      return String(value);
    case "string":
      return value;
    default:
      break;
  }
  switch (value.kind) {
    case "bigint":
      return value.value;
    case "json":
      return value.text;
    case "date":
      return value.iso;
    case "bytes":
      return bytesText(value.preview, value.length);
  }
}
