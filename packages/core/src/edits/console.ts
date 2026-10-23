import type { Capability, Column, ColumnMeta, Relation, SelectSource } from "@table-craft/plugin-api";
import type { EditColumn, EditTable } from "@table-craft/core/edits/generate.js";
import { editableIdentity, READ_ONLY_REASONS } from "@table-craft/core/edits/identity.js";

/** Why a console result is read-only, phrased to follow "Read-only: " (decision 056). */
export const CONSOLE_READ_ONLY_REASONS = {
  noKey: "the result has no primary key column",
  columns: "the result's columns differ from the statement; synchronize the catalog",
  origins: "the driver reports columns from more than one table",
  datasource: "the datasource is read-only",
  transactions: "the plugin cannot run a transaction",
  view: "the result reads a view",
  materializedView: "the result reads a materialized view",
  unsupported: "the plugin cannot tell which table the result reads",
} as const;

const IDENTITY_REASONS: Readonly<Record<string, string>> = {
  [READ_ONLY_REASONS.datasource]: CONSOLE_READ_ONLY_REASONS.datasource,
  [READ_ONLY_REASONS.transactions]: CONSOLE_READ_ONLY_REASONS.transactions,
  [READ_ONLY_REASONS.view]: CONSOLE_READ_ONLY_REASONS.view,
  [READ_ONLY_REASONS.materializedView]: CONSOLE_READ_ONLY_REASONS.materializedView,
  [READ_ONLY_REASONS.noKey]: CONSOLE_READ_ONLY_REASONS.noKey,
};

export interface ConsoleEditColumn extends EditColumn {
  /** True for a computed, aliased-expression or repeated column, which edits never write. */
  readonly readOnly: boolean;
}

export interface ConsoleEditTable extends EditTable {
  readonly columns: readonly ConsoleEditColumn[];
}

/** One console result checked for editing: the table to write, or why it cannot be written. */
export type ConsoleEditable =
  | {
      readonly kind: "editable";
      readonly table: ConsoleEditTable;
      /** The catalog's column per result column, null for an expression. */
      readonly columns: readonly (ColumnMeta | null)[];
    }
  | { readonly kind: "readOnly"; readonly reason: string };

export interface ConsoleEditableOptions {
  /** What the plugin read from the statement text (decision 008). */
  readonly source: SelectSource;
  /** The catalog's description of `source`'s table; null when the source is read-only. */
  readonly relation: Relation | null;
  /** The table name as the plugin qualifies and quotes it. */
  readonly qualified: string;
  /** The columns the driver reported for the result. */
  readonly result: readonly Column[];
  readonly readOnly: boolean;
  readonly capabilities: readonly Capability[];
}

function readOnly(reason: string): ConsoleEditable {
  return { kind: "readOnly", reason };
}

/**
 * Whether a console result can be edited, and how (decision 056). The statement must read one base
 * table with a key, every key column must come back as a plain column, and when the driver reports
 * where each column came from, every plain column must come from one table and every expression
 * from none. Anything less is read-only with the reason, never a guess.
 */
export function consoleEditable(options: ConsoleEditableOptions): ConsoleEditable {
  const { source, relation, result } = options;
  if (source.kind === "readOnly") return readOnly(source.reason);
  if (relation === null) return readOnly(CONSOLE_READ_ONLY_REASONS.unsupported);
  if (source.columns.length !== result.length) return readOnly(CONSOLE_READ_ONLY_REASONS.columns);

  const identity = editableIdentity(relation, options.readOnly, options.capabilities);
  if ("readOnly" in identity) return readOnly(IDENTITY_REASONS[identity.readOnly] ?? identity.readOnly);

  const byName = new Map(relation.columns.map((column) => [column.name, column]));
  const names = source.columns.map((name) => (name !== null && byName.has(name) ? name : null));
  const tables = new Set<string>();
  for (const [index, column] of result.entries()) {
    const origin = column.origin;
    if (origin === undefined) continue;
    if ((origin === null) !== (names[index] === null)) return readOnly(CONSOLE_READ_ONLY_REASONS.columns);
    if (origin !== null) tables.add(origin.table);
  }
  if (tables.size > 1) return readOnly(CONSOLE_READ_ONLY_REASONS.origins);

  const counts = new Map<string, number>();
  for (const name of names) if (name !== null) counts.set(name, (counts.get(name) ?? 0) + 1);
  const columns = result.map((column, index): ConsoleEditColumn => {
    const name = names[index] ?? null;
    const meta = name === null ? undefined : byName.get(name);
    return {
      name: meta?.name ?? column.name,
      type: meta?.type ?? column.type,
      default: meta?.default ?? null,
      readOnly: meta === undefined || (counts.get(meta.name) ?? 0) > 1,
    };
  });

  const keyIndexes = identity.identity.map((key) => names.indexOf(key));
  if (keyIndexes.some((index) => index < 0)) return readOnly(CONSOLE_READ_ONLY_REASONS.noKey);

  return {
    kind: "editable",
    table: { table: options.qualified, columns, identity: keyIndexes },
    columns: names.map((name) => (name === null ? null : (byName.get(name) ?? null))),
  };
}
