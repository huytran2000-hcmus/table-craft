/** Bytes shown of a binary value; the rest stays in the database (decision 009). */
export const BYTES_PREVIEW_LENGTH = 32;

export interface BigIntValue {
  readonly kind: "bigint";
  readonly value: string;
}

export interface BytesValue {
  readonly kind: "bytes";
  /** Lower-case hex of the first `BYTES_PREVIEW_LENGTH` bytes. */
  readonly preview: string;
  readonly length: number;
}

export interface JsonValue {
  readonly kind: "json";
  readonly text: string;
}

export interface DateValue {
  readonly kind: "date";
  readonly iso: string;
}

/**
 * One cell as it crosses a process boundary. Anything structured clone would mangle, or that is
 * too large to ship whole, is tagged.
 */
export type WireValue = null | boolean | number | string | BigIntValue | BytesValue | JsonValue | DateValue;

const HEX_RADIX = 16;
const HEX_BYTE_WIDTH = 2;

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(HEX_RADIX).padStart(HEX_BYTE_WIDTH, "0");
  return hex;
}

/** A 64-bit integer as a number when it is exact in a double, tagged otherwise. */
export function toWireInteger(value: bigint | string): number | BigIntValue {
  const exact = BigInt(value);
  if (exact >= BigInt(Number.MIN_SAFE_INTEGER) && exact <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(exact);
  return { kind: "bigint", value: exact.toString() };
}

/** Converts what a JavaScript driver typically returns into a `WireValue`. */
export function toWireValue(value: unknown): WireValue {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case "boolean":
    case "number":
    case "string":
      return value;
    case "bigint":
      return { kind: "bigint", value: value.toString() };
    default:
      break;
  }
  if (value instanceof Uint8Array) {
    return { kind: "bytes", preview: toHex(value.subarray(0, BYTES_PREVIEW_LENGTH)), length: value.byteLength };
  }
  if (value instanceof Date) return { kind: "date", iso: value.toISOString() };
  return { kind: "json", text: JSON.stringify(value) };
}
