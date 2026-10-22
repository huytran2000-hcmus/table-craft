import type { Capability, Relation } from "@table-craft/plugin-api";

/** How the data editor may change a table's rows (decision 026). */
export type EditableIdentity = { readonly identity: readonly string[] } | { readonly readOnly: string };

export const READ_ONLY_REASONS = {
  datasource: "The datasource is read-only.",
  transactions: "This datasource's plugin cannot run a transaction, so edits could not be submitted together.",
  view: "Views are read-only.",
  materializedView: "Materialized views are read-only.",
  noKey: "No primary key or non-null unique key identifies a row.",
} as const;

/**
 * The columns that name one row of `relation`: its primary key, else the first unique key whose
 * columns are all `NOT NULL`. Anything less is read-only with the reason, never a guess.
 */
export function editableIdentity(
  relation: Relation,
  readOnly: boolean,
  capabilities: readonly Capability[],
): EditableIdentity {
  if (readOnly) return { readOnly: READ_ONLY_REASONS.datasource };
  if (!capabilities.includes("transactions")) return { readOnly: READ_ONLY_REASONS.transactions };
  if (relation.kind === "view") return { readOnly: READ_ONLY_REASONS.view };
  if (relation.kind === "materializedView") return { readOnly: READ_ONLY_REASONS.materializedView };
  if (relation.primaryKey !== null && relation.primaryKey.columns.length > 0) {
    return { identity: relation.primaryKey.columns };
  }
  const notNull = new Set(relation.columns.filter((column) => !column.nullable).map((column) => column.name));
  const unique = relation.uniqueKeys.find(
    (key) => key.columns.length > 0 && key.columns.every((name) => notNull.has(name)),
  );
  return unique === undefined ? { readOnly: READ_ONLY_REASONS.noKey } : { identity: unique.columns };
}
