import type { Column, Row, SqlLanguage } from "@table-craft/plugin-api";
import type { RowWriter } from "@table-craft/core/results/extract/writer.js";

/** DataGrip's placeholder: a result has no table of its own to name. */
export const SQL_INSERT_TABLE = "MY_TABLE";

export type SqlDialect = Pick<SqlLanguage, "quoteIdentifier" | "literal">;

/** One `INSERT` per row, quoted and spelled by the datasource's plugin (decision 008). */
export function sqlInsertWriter(columns: readonly Column[], dialect: SqlDialect, table: string): RowWriter {
  const names = columns.map((column) => dialect.quoteIdentifier(column.name)).join(", ");
  return {
    start: () => "",
    row: (row: Row) => {
      const values = columns.map((column, at) => dialect.literal(row[at] ?? null, column.type)).join(", ");
      return `INSERT INTO ${table} (${names}) VALUES (${values});\n`;
    },
    end: () => "",
  };
}
