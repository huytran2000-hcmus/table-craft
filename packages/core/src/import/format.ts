export const IMPORT_ENCODINGS = ["auto", "utf-8", "utf-16le", "utf-16be", "windows-1252"] as const;

/** `auto` reads a byte-order mark and falls back to UTF-8 without one. */
export type ImportEncoding = (typeof IMPORT_ENCODINGS)[number];

export const IMPORT_ESCAPES = ["double", "backslash"] as const;

/** `double`: a quote inside quotes is written twice (RFC 4180). `backslash`: `\t` `\n` `\r` `\\` and a backslashed quote or delimiter. */
export type ImportEscape = (typeof IMPORT_ESCAPES)[number];

/** How a delimited text file is read (plan 021). */
export interface ImportFormat {
  readonly delimiter: string;
  /** Null when fields are never quoted, as in the exporter's TSV. */
  readonly quote: string | null;
  readonly escape: ImportEscape;
  /** The first record names the columns and is not imported. */
  readonly header: boolean;
  readonly encoding: ImportEncoding;
  /** An unquoted field equal to this is NULL; `""` makes the empty field NULL. */
  readonly nullToken: string;
  /** Strip spaces and tabs around unquoted fields. */
  readonly trim: boolean;
}

/** What `csv.ts` in the exporter writes. */
export const CSV_FORMAT: ImportFormat = {
  delimiter: ",",
  quote: '"',
  escape: "double",
  header: true,
  encoding: "auto",
  nullToken: "",
  trim: false,
};

/** What `tsv.ts` in the exporter writes: tabs, no quotes, backslash escapes. */
export const TSV_FORMAT: ImportFormat = {
  delimiter: "\t",
  quote: null,
  escape: "backslash",
  header: true,
  encoding: "auto",
  nullToken: "",
  trim: false,
};

const LINE_BREAKS = new Set(["\r", "\n"]);

/** Why `format` cannot be read; null when it can. */
export function formatProblem(format: ImportFormat): string | null {
  if ([...format.delimiter].length !== 1) return "The delimiter must be one character.";
  if (LINE_BREAKS.has(format.delimiter)) return "The delimiter cannot be a line break.";
  if (format.quote !== null) {
    if ([...format.quote].length !== 1) return "The quote must be one character, or none.";
    if (format.quote === format.delimiter) return "The quote and the delimiter must differ.";
    if (LINE_BREAKS.has(format.quote)) return "The quote cannot be a line break.";
  }
  if (format.escape === "backslash" && (format.delimiter === "\\" || format.quote === "\\")) {
    return "A backslash cannot be the delimiter or quote when it escapes.";
  }
  return null;
}
