import { BYTES_PREVIEW_LENGTH, type WireValue } from "@table-craft/plugin-api";

const CLIPPED_MARK = "…";

/** `0x` and the preview hex, marked when the value is longer than its preview (decision 017). */
export function bytesText(preview: string, length: number): string {
  return `0x${preview}${length > BYTES_PREVIEW_LENGTH ? CLIPPED_MARK : ""}`;
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
