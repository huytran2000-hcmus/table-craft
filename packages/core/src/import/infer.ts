import type { ImportKind, InferredColumn } from "@table-craft/plugin-api";

/** Rows of the preview the kinds are inferred from (plan 021, ruling 9). */
export const INFERENCE_SAMPLE_ROWS = 1_000;

const INT32_MAX = 2n ** 31n - 1n;
const INT64_MAX = 2n ** 63n - 1n;

const INTEGER = /^[+-]?(?:0|[1-9]\d*)$/u;
const DECIMAL = /^[+-]?(?:0|[1-9]\d*)\.(\d+)$/u;
const DOUBLE = /^[+-]?(?:\d+\.?\d*|\.\d+)[eE][+-]?\d+$/u;
const BOOLEAN = /^(?:true|false)$/iu;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?$/u;

/** Each family widens left to right; kinds of different families meet at `text`. */
const FAMILIES: readonly (readonly ImportKind[])[] = [
  ["integer", "bigint", "decimal", "double"],
  ["date", "timestamp"],
  ["boolean"],
];

interface Shape {
  readonly kind: ImportKind;
  readonly integerDigits: number;
  readonly scale: number;
}

function digitsOf(text: string): number {
  return text.replace(/^[+-]/u, "").length;
}

function shapeOf(text: string): Shape {
  if (INTEGER.test(text)) {
    const magnitude = BigInt(text.replace(/^\+/u, ""));
    const absolute = magnitude < 0n ? -magnitude : magnitude;
    if (absolute <= INT32_MAX) return { kind: "integer", integerDigits: digitsOf(text), scale: 0 };
    if (absolute <= INT64_MAX) return { kind: "bigint", integerDigits: digitsOf(text), scale: 0 };
    return { kind: "decimal", integerDigits: digitsOf(text), scale: 0 };
  }
  const decimal = DECIMAL.exec(text);
  if (decimal !== null) {
    const scale = decimal[1]?.length ?? 0;
    return { kind: "decimal", integerDigits: digitsOf(text) - scale - 1, scale };
  }
  if (DOUBLE.test(text)) return { kind: "double", integerDigits: 0, scale: 0 };
  if (BOOLEAN.test(text)) return { kind: "boolean", integerDigits: 0, scale: 0 };
  if (DATE.test(text)) return { kind: "date", integerDigits: 0, scale: 0 };
  if (TIMESTAMP.test(text)) return { kind: "timestamp", integerDigits: 0, scale: 0 };
  return { kind: "text", integerDigits: 0, scale: 0 };
}

function widen(left: ImportKind, right: ImportKind): ImportKind {
  if (left === right) return left;
  const family = FAMILIES.find((kinds) => kinds.includes(left) && kinds.includes(right));
  if (family === undefined) return "text";
  return family.indexOf(left) > family.indexOf(right) ? left : right;
}

/**
 * The narrowest kind every non-NULL value of each of `width` columns fits (plan 021, ruling 9);
 * a column with no value in the sample is `text`. Values are compared trimmed.
 */
export function inferColumns(rows: readonly (readonly (string | null)[])[], width: number): InferredColumn[] {
  const columns: InferredColumn[] = [];
  for (let index = 0; index < width; index += 1) {
    let kind: ImportKind | null = null;
    let integerDigits = 0;
    let scale = 0;
    for (const row of rows) {
      const value = row[index];
      if (value === null || value === undefined) continue;
      const shape = shapeOf(value.trim());
      kind = kind === null ? shape.kind : widen(kind, shape.kind);
      integerDigits = Math.max(integerDigits, shape.integerDigits);
      scale = Math.max(scale, shape.scale);
      if (kind === "text") break;
    }
    const settled = kind ?? "text";
    columns.push({
      kind: settled,
      integerDigits: settled === "decimal" ? integerDigits : 0,
      scale: settled === "decimal" ? scale : 0,
    });
  }
  return columns;
}
