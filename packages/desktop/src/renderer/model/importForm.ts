import type {
  ImportErrorPolicy,
  ImportFormat,
  ImportMapping,
  ImportPreview,
  ImportTransaction,
  NewImportColumn,
} from "@table-craft/desktop/engine/protocol.js";

/** Mirrors `CSV_FORMAT` in core; `test/renderer/importForm.test.ts` keeps them equal. */
export const CSV_PRESET: ImportFormat = {
  delimiter: ",",
  quote: '"',
  escape: "double",
  header: true,
  encoding: "auto",
  nullToken: "",
  trim: false,
};

/** Mirrors `TSV_FORMAT` in core: what the TSV exporter writes. */
export const TSV_PRESET: ImportFormat = { ...CSV_PRESET, delimiter: "\t", quote: null, escape: "backslash" };

export const DELIMITERS: readonly { readonly label: string; readonly value: string }[] = [
  { label: "Comma", value: "," },
  { label: "Semicolon", value: ";" },
  { label: "Tab", value: "\t" },
  { label: "Pipe", value: "|" },
];

export const QUOTES: readonly { readonly label: string; readonly value: string | null }[] = [
  { label: 'Double (")', value: '"' },
  { label: "Single (')", value: "'" },
  { label: "None", value: null },
];

/** Plan 021 ruling 9: Commit every N starts at this N. */
export const DEFAULT_COMMIT_ROWS = 10_000;
/** Plan 021 ruling 11: Skip starts at this many rejected rows. */
export const DEFAULT_REJECT_LIMIT = 100;

const TSV_EXTENSION = /\.tsv$/iu;

/** The preset a file's extension suggests. */
export function presetFor(file: string): ImportFormat {
  return TSV_EXTENSION.test(file) ? TSV_PRESET : CSV_PRESET;
}

/** A file's base name without its extension: the new table's suggested name. */
export function tableNameOf(file: string): string {
  const base = file.split(/[\\/]/u).pop() ?? file;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * The field each table column takes when the dialog opens: the field of the same name (ignoring
 * case) with a header, the field in the same position without one; null skips the column.
 */
export function defaultMapping(
  columns: readonly string[],
  preview: Pick<ImportPreview, "names">,
  header: boolean,
): readonly (number | null)[] {
  if (!header) return columns.map((_, index) => (index < preview.names.length ? index : null));
  const byName = new Map(preview.names.map((name, index) => [name.toLowerCase(), index] as const).reverse());
  return columns.map((column) => byName.get(column.toLowerCase()) ?? null);
}

export function mappingOf(columns: readonly string[], fields: readonly (number | null)[]): readonly ImportMapping[] {
  return columns.flatMap((column, index) => {
    const field = fields[index];
    return field == null ? [] : [{ column, field }];
  });
}

/** One field of the file as a new table's column in the dialog. */
export interface NewColumnDraft {
  readonly include: boolean;
  readonly name: string;
  readonly type: string;
}

export function newColumnDrafts(preview: Pick<ImportPreview, "names" | "types">): readonly NewColumnDraft[] {
  return preview.names.map((name, index) => ({ include: true, name, type: preview.types[index] ?? "" }));
}

export function newColumnsOf(drafts: readonly NewColumnDraft[]): readonly NewImportColumn[] {
  return drafts.flatMap((draft, field) =>
    draft.include ? [{ name: draft.name.trim(), type: draft.type.trim(), field }] : [],
  );
}

/** Why the new columns cannot be created as drafted, or null. */
export function newColumnsProblem(columns: readonly NewImportColumn[]): string | null {
  if (columns.length === 0) return "Include at least one column.";
  if (columns.some((column) => column.name === "")) return "Every included column needs a name.";
  if (columns.some((column) => column.type === "")) return "Every included column needs a type.";
  const seen = new Set<string>();
  for (const { name } of columns) {
    const key = name.toLowerCase();
    if (seen.has(key)) return `Two columns are named ${name}.`;
    seen.add(key);
  }
  return null;
}

/** Parses a positive whole number typed into a field; null when it is not one. */
export function positiveCount(text: string): number | null {
  const value = Number(text);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function transactionOf(every: boolean, rows: number): ImportTransaction {
  return every ? { mode: "every", rows } : { mode: "all" };
}

export function errorPolicyOf(skip: boolean, limit: number): ImportErrorPolicy {
  return skip ? { mode: "skip", limit } : { mode: "stop" };
}
