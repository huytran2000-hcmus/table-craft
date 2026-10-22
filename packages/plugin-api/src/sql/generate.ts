import type { ColumnMeta, GeneratedStatement, Relation, SqlLanguage } from "@table-craft/plugin-api";

/** What the shared generator needs to know about a dialect (decision 029). */
export interface GeneratorOptions {
  readonly quoteIdentifier: (name: string) => string;
  readonly updateDefault: (defaultExpression: string | null) => string;
  /** A name the dialect reads back unchanged without quotes; any other is quoted. */
  readonly plainIdentifier: RegExp;
  /** A name that spells one of these is quoted. Upper case. */
  readonly keywords: readonly string[];
}

const NULL = "NULL";
const INDENT = "  ";

const DROP_KEYWORDS: Readonly<Record<Relation["kind"], string>> = {
  table: "DROP TABLE",
  view: "DROP VIEW",
  materializedView: "DROP MATERIALIZED VIEW",
};

/** DROP, SELECT, INSERT and UPDATE for a catalog relation, which every built-in plugin spreads into its `SqlLanguage`. */
export function sqlGenerator(options: GeneratorOptions): Pick<SqlLanguage, "generate"> {
  const reserved = new Set(options.keywords.map((keyword) => keyword.toUpperCase()));

  // The completer's rule, so a generated statement spells a name as completion inserts it.
  function name(identifier: string): string {
    return options.plainIdentifier.test(identifier) && !reserved.has(identifier.toUpperCase())
      ? identifier
      : options.quoteIdentifier(identifier);
  }

  function list(columns: readonly ColumnMeta[]): string {
    return columns.map((column) => name(column.name)).join(", ");
  }

  function insertValue(column: ColumnMeta): string {
    return column.default === null ? NULL : options.updateDefault(column.default);
  }

  function update(relation: Relation, qualifiedName: string): string {
    const keyNames = new Set(relation.primaryKey?.columns ?? []);
    const keyed = keyNames.size > 0;
    const unkeyed = relation.columns.filter((column) => !keyNames.has(column.name));
    // A table that is all key still needs a SET, so the key columns fill it.
    const set = unkeyed.length > 0 ? unkeyed : relation.columns;
    const where = keyed ? relation.columns.filter((column) => keyNames.has(column.name)) : relation.columns;
    return [
      `UPDATE ${qualifiedName}`,
      `SET ${set.map((column) => `${name(column.name)} = ${NULL}`).join(`,\n${INDENT}${INDENT}`)}`,
      `WHERE ${where.map((column) => `${name(column.name)} = ${NULL}`).join(`\n${INDENT}AND `)};`,
    ].join("\n");
  }

  return {
    generate(statement: GeneratedStatement, relation: Relation, qualifiedName: string): string {
      switch (statement) {
        case "drop":
          return `${DROP_KEYWORDS[relation.kind]} ${qualifiedName};`;
        case "select":
          return `SELECT ${list(relation.columns)}\nFROM ${qualifiedName};`;
        case "insert": {
          const assigned = relation.columns.filter((column) => !column.autoIncrement);
          const columns = assigned.length > 0 ? assigned : relation.columns;
          return `INSERT INTO ${qualifiedName} (${list(columns)})\nVALUES (${columns.map(insertValue).join(", ")});`;
        }
        case "update":
          return update(relation, qualifiedName);
      }
    },
  };
}
