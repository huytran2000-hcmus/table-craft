import type { SqlLanguage, WireValue } from "@table-craft/plugin-api";
import { CoreError } from "@table-craft/core/errors.js";

/** What the table editor's WHERE and ORDER BY bars hold, verbatim; empty means absent. */
export interface TableClauses {
  readonly where: string;
  readonly orderBy: string;
}

/** A column a condition matches on: the name it is written with and the type its literal takes. */
export interface ConditionColumn {
  readonly name: string;
  readonly type: string | null;
}

const TRAILING_SEMICOLONS = /[\s;]+$/u;

/** A bar's text with surrounding space and trailing semicolons dropped, so `id > 3;` still nests. */
function clause(text: string): string {
  return text.replace(TRAILING_SEMICOLONS, "").trim();
}

function whereClause(where: string): string {
  const condition = clause(where);
  return condition === "" ? "" : ` WHERE ${condition}`;
}

/**
 * The table editor's query: every column of `table`, filtered and ordered by the bars' text as typed
 * (plan 008). The bars are SQL the user writes, so the database, not the editor, judges them.
 */
export function tableSelect(table: string, clauses: TableClauses): string {
  const order = clause(clauses.orderBy);
  return `SELECT * FROM ${table}${whereClause(clauses.where)}${order === "" ? "" : ` ORDER BY ${order}`}`;
}

/** Count Rows: how many rows the WHERE bar lets through. */
export function tableCount(table: string, where: string): string {
  return `SELECT COUNT(*) FROM ${table}${whereClause(where)}`;
}

/** One ORDER BY term the grid's header asks for: a column by name and its direction. */
export interface OrderTerm {
  readonly name: string;
  readonly direction: "asc" | "desc";
}

/** The ORDER BY bar's text for header-click sorting, with names quoted by the plugin (decision 008). */
export function orderClause(language: SqlLanguage, terms: readonly OrderTerm[]): string {
  return terms
    .map((term) => `${language.quoteIdentifier(term.name)}${term.direction === "desc" ? " DESC" : ""}`)
    .join(", ");
}

function isBytes(value: WireValue): boolean {
  return typeof value === "object" && value !== null && value.kind === "bytes";
}

/**
 * A WHERE condition matching rows whose `columns` hold one of `tuples`, for Filter by This Value and
 * foreign-key navigation. One column becomes `= v`, `IS NULL` or `IN (...)`; several become an `OR`
 * of `AND`ed equalities. Duplicate tuples collapse. Bytes refuse: their wire value is only a preview.
 */
export function matchCondition(
  language: SqlLanguage,
  columns: readonly ConditionColumn[],
  tuples: readonly (readonly WireValue[])[],
): string {
  if (columns.length === 0 || tuples.length === 0) {
    throw new CoreError("invalidRequest", "A filter needs at least one column and one row.", "Select a cell first.");
  }
  const names = columns.map((column) => language.quoteIdentifier(column.name));

  function literalOf(value: WireValue, index: number): string | null {
    if (value === null) return null;
    if (isBytes(value)) {
      throw new CoreError(
        "invalidRequest",
        `Column ${columns[index]?.name ?? String(index)} holds bytes, which cannot be matched.`,
        "Filter on another column.",
      );
    }
    return language.literal(value, columns[index]?.type ?? null);
  }

  const rendered = tuples.map((tuple) => columns.map((_, index) => literalOf(tuple[index] ?? null, index)));
  const unique = [...new Map(rendered.map((literals) => [JSON.stringify(literals), literals])).values()];

  if (columns.length === 1) {
    const name = names[0] ?? "";
    const literals = unique.flatMap(([literal]) => (literal === null || literal === undefined ? [] : [literal]));
    const hasNull = literals.length < unique.length;
    const match =
      literals.length === 0
        ? ""
        : literals.length === 1
          ? `${name} = ${literals[0] ?? ""}`
          : `${name} IN (${literals.join(", ")})`;
    if (!hasNull) return match;
    return match === "" ? `${name} IS NULL` : `(${match} OR ${name} IS NULL)`;
  }

  const conjunctions = unique.map((literals) =>
    literals
      .map((literal, index) => `${names[index] ?? ""} ${literal === null ? "IS NULL" : `= ${literal}`}`)
      .join(" AND "),
  );
  return conjunctions.length === 1 ? (conjunctions[0] ?? "") : conjunctions.map((each) => `(${each})`).join(" OR ");
}
