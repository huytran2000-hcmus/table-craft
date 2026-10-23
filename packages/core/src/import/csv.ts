import type { ImportFormat } from "@table-craft/core/import/format.js";

/** A field longer than this is an opening quote that never closes, not data (plan 021, ruling 5). */
export const MAX_FIELD_CHARS = 16 * 1024 ** 2;
/** A record longer than this is a file without line breaks, not data. */
export const MAX_RECORD_CHARS = 64 * 1024 ** 2;

const BACKSLASH = "\\";
const UNESCAPED: ReadonlyMap<string, string> = new Map([
  ["t", "\t"],
  ["n", "\n"],
  ["r", "\r"],
]);
const REGEX_SPECIAL = /[\\\]^-]/gu;

/** One record of the file: its fields, NULL where the NULL token stood unquoted, and the line it starts on. */
export interface CsvRecord {
  readonly fields: readonly (string | null)[];
  readonly line: number;
}

/** The file cannot be read as delimited text; `line` is where the bad record starts. */
export class CsvError extends Error {
  override readonly name = "CsvError";

  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
  }
}

function charClass(chars: readonly string[]): RegExp {
  const body = chars.map((char) => char.replace(REGEX_SPECIAL, (special) => `\\${special}`)).join("");
  return new RegExp(`[${body}]`, "gu");
}

const TRIMMED = /^[ \t]+|[ \t]+$/gu;

/**
 * A streaming RFC 4180 reader (plan 021, ruling 2). `push` takes text in any slices and returns the
 * records they complete; a quoted line break, a CRLF or an escape split across two pushes reads the
 * same as in one. Blank lines are skipped. Runs of plain characters are sliced, not copied one by one.
 */
export class CsvReader {
  readonly #format: ImportFormat;
  readonly #plain: RegExp;
  readonly #inQuotes: RegExp;
  readonly #backslash: boolean;
  /** The raw text of an unquoted field is kept only when an escape could hide a NULL token like `\N`. */
  readonly #trackRaw: boolean;
  readonly #maxField: number;

  #line = 1;
  #recordLine = 1;
  #recordStarted = false;
  #recordChars = 0;
  #fields: (string | null)[] = [];
  #field = "";
  #raw = "";
  #quoted = false;
  #fresh = true;
  #quoting = false;
  #afterQuote = false;
  #afterBackslash = false;
  #afterCarriageReturn = false;

  constructor(format: ImportFormat, maxFieldChars = MAX_FIELD_CHARS) {
    this.#format = format;
    this.#backslash = format.escape === "backslash";
    this.#trackRaw = this.#backslash && format.nullToken.includes(BACKSLASH);
    this.#maxField = maxFieldChars;
    const plain = [format.delimiter, "\r", "\n"];
    if (this.#backslash) plain.push(BACKSLASH);
    this.#plain = charClass(plain);
    const quoted = [format.quote ?? "", "\n"];
    if (this.#backslash) quoted.push(BACKSLASH);
    this.#inQuotes = charClass(quoted.filter((char) => char !== ""));
  }

  /** The line the next character would be on, counting from 1. */
  get line(): number {
    return this.#line;
  }

  push(text: string): CsvRecord[] {
    const records: CsvRecord[] = [];
    const { delimiter, quote } = this.#format;
    const length = text.length;
    let at = 0;
    while (at < length) {
      if (this.#afterCarriageReturn) {
        this.#afterCarriageReturn = false;
        if (text[at] === "\n") {
          at += 1;
          continue;
        }
      }
      if (this.#afterBackslash) {
        this.#unescape(text.charAt(at));
        at += 1;
        continue;
      }
      if (this.#afterQuote) {
        this.#afterQuote = false;
        if (text[at] === quote && this.#format.escape === "double") {
          this.#append(quote);
          this.#quoting = true;
          at += 1;
          continue;
        }
      }
      if (this.#quoting) {
        at = this.#scan(text, at, this.#inQuotes);
        if (at >= length) break;
        const char = text.charAt(at);
        at += 1;
        if (char === "\n") {
          this.#append(char);
          this.#line += 1;
        } else if (char === quote) {
          this.#quoting = false;
          this.#afterQuote = true;
        } else {
          this.#afterBackslash = true;
        }
        continue;
      }
      if (this.#fresh && quote !== null && text[at] === quote) {
        this.#begin();
        this.#fresh = false;
        this.#quoted = true;
        this.#quoting = true;
        at += 1;
        continue;
      }
      at = this.#scan(text, at, this.#plain);
      if (at >= length) break;
      const char = text.charAt(at);
      at += 1;
      if (char === delimiter) {
        this.#begin();
        this.#endField();
      } else if (char === "\r" || char === "\n") {
        if (this.#recordStarted) records.push(this.#endRecord());
        this.#line += 1;
        this.#afterCarriageReturn = char === "\r";
      } else {
        this.#begin();
        this.#fresh = false;
        this.#afterBackslash = true;
      }
    }
    return records;
  }

  /** The last record, when the file does not end with a line break. */
  end(): CsvRecord[] {
    if (this.#afterBackslash) {
      this.#afterBackslash = false;
      this.#append(BACKSLASH);
    }
    if (this.#quoting) {
      throw new CsvError(
        `Line ${String(this.#recordLine)}: a quoted field is never closed; check the quote character.`,
        this.#recordLine,
      );
    }
    return this.#recordStarted ? [this.#endRecord()] : [];
  }

  /** Appends the plain run from `from` up to the next character `special` matches; returns where it stopped. */
  #scan(text: string, from: number, special: RegExp): number {
    special.lastIndex = from;
    const match = special.exec(text);
    const to = match === null ? text.length : match.index;
    if (to > from) {
      this.#begin();
      this.#fresh = false;
      this.#append(text.slice(from, to));
    }
    return to;
  }

  #begin(): void {
    if (this.#recordStarted) return;
    this.#recordStarted = true;
    this.#recordLine = this.#line;
  }

  #append(text: string): void {
    this.#field += text;
    if (this.#trackRaw && !this.#quoted) this.#raw += text;
    this.#recordChars += text.length;
    if (this.#field.length > this.#maxField) {
      throw new CsvError(
        `Line ${String(this.#recordLine)}: a field runs past ${String(this.#maxField / 1024 ** 2)} MiB; a quote is probably never closed. Check the quote character.`,
        this.#recordLine,
      );
    }
    if (this.#recordChars > MAX_RECORD_CHARS) {
      throw new CsvError(
        `Line ${String(this.#recordLine)}: a record runs past ${String(MAX_RECORD_CHARS / 1024 ** 2)} MiB without a line break; check the delimiter and the file.`,
        this.#recordLine,
      );
    }
  }

  #unescape(char: string): void {
    this.#afterBackslash = false;
    const value = UNESCAPED.get(char) ?? char;
    this.#field += value;
    if (this.#trackRaw && !this.#quoted) this.#raw += BACKSLASH + char;
    this.#recordChars += 1;
    if (char === "\n") this.#line += 1;
  }

  #endField(): void {
    const { nullToken, trim } = this.#format;
    let value = this.#field;
    if (!this.#quoted) {
      if (trim) value = value.replace(TRIMMED, "");
      const raw = this.#trackRaw ? (trim ? this.#raw.replace(TRIMMED, "") : this.#raw) : value;
      this.#fields.push(raw === nullToken ? null : value);
    } else {
      this.#fields.push(value);
    }
    this.#field = "";
    this.#raw = "";
    this.#quoted = false;
    this.#fresh = true;
  }

  #endRecord(): CsvRecord {
    this.#endField();
    const record: CsvRecord = { fields: this.#fields, line: this.#recordLine };
    this.#fields = [];
    this.#recordStarted = false;
    this.#recordChars = 0;
    return record;
  }
}
