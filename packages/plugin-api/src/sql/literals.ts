import type { WireValue } from "@table-craft/plugin-api";

/** How a dialect spells what the shared literal writer cannot decide for it. */
export interface SqlLiteralOptions {
  /** `'` doubled is standard; MySQL also needs backslashes escaped unless `NO_BACKSLASH_ESCAPES` is set. */
  readonly backslashEscapes: boolean;
  /** A bytes literal from lower-case hex, such as `X'dead'` or `'\xdead'::bytea`. */
  readonly bytes: (hex: string) => string;
}

/** Quotes an identifier with `quote`, doubling any `quote` inside it, as SQL and MySQL both read it. */
export function quoteIdentifierWith(quote: '"' | "`"): (name: string) => string {
  return (name) => `${quote}${name.replaceAll(quote, quote + quote)}${quote}`;
}

/** The standard insert of a row made only of defaults, which PostgreSQL and SQLite accept. */
export function defaultValuesInsert(qualifiedTable: string): string {
  return `INSERT INTO ${qualifiedTable} DEFAULT VALUES`;
}

/** `DEFAULT` inside `SET`, which PostgreSQL and MySQL accept. */
export function defaultKeyword(): string {
  return "DEFAULT";
}

const BACKSLASH_ESCAPES: ReadonlyMap<string, string> = new Map([
  ["\\", "\\\\"],
  ["'", "\\'"],
  ["\0", "\\0"],
  ["\n", "\\n"],
  ["\r", "\\r"],
  ["\u001a", "\\Z"],
]);

function quoteString(text: string, options: SqlLiteralOptions): string {
  if (options.backslashEscapes) {
    return `'${Array.from(text, (char) => BACKSLASH_ESCAPES.get(char) ?? char).join("")}'`;
  }
  return `'${text.replaceAll("'", "''")}'`;
}

const BYTES_PER_HEX_DIGIT = 0.5;

/**
 * A literal any of the three built-in dialects reads back as the same value. Decimals, dates and
 * JSON travel as text (decision 017), so they are written as strings and the column's type
 * converts them; `columnType` is accepted for dialects that need a cast.
 */
export function sqlLiteral(value: WireValue, options: SqlLiteralOptions): string {
  if (value === null) return "NULL";
  switch (typeof value) {
    case "boolean":
      return value ? "TRUE" : "FALSE";
    case "number":
      return Number.isFinite(value) ? String(value) : quoteString(String(value), options);
    case "string":
      return quoteString(value, options);
    default:
      break;
  }
  switch (value.kind) {
    case "bigint":
      return value.value;
    case "json":
      return quoteString(value.text, options);
    case "date":
      return quoteString(value.iso, options);
    case "bytes": {
      const literal = options.bytes(value.preview);
      const shown = value.preview.length * BYTES_PER_HEX_DIGIT;
      return shown < value.length ? `${literal} /* ${String(shown)} of ${String(value.length)} bytes */` : literal;
    }
  }
}
