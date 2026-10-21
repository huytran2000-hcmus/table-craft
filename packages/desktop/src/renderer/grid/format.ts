import type { WireValue } from "@table-craft/desktop/engine/protocol.js";

export const NULL_TEXT = "<null>";
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
