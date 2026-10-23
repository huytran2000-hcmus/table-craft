import type {
  CheckDesign,
  ColumnDesign,
  DdlContext,
  DdlScript,
  ForeignKeyDesign,
  IndexDesign,
  ObjectChange,
  ObjectEditor,
  ObjectKind,
  TableDesign,
} from "@table-craft/plugin-api";
import {
  ddlScript,
  designError,
  NOTHING_TO_CHANGE,
  referencesClause,
  tableDesignOf,
  tableDifference,
  unchanged,
  validateDesign,
} from "@table-craft/plugin-api/sql";

const INDENT = "  ";

/** MySQL commits before and after every DDL statement (https://dev.mysql.com/doc/refman/8.0/en/implicit-commit.html). */
export const IMPLICIT_COMMIT_NOTE =
  "MySQL commits each DDL statement on its own: it cannot be rolled back, and a failure part-way keeps the statements before it.";

const TYPES = [
  "int",
  "bigint",
  "smallint",
  "decimal(12,2)",
  "varchar(255)",
  "text",
  "tinyint(1)",
  "date",
  "datetime",
  "timestamp",
  "json",
  "blob",
  "double",
];

const KEYWORDS: Readonly<Partial<Record<ObjectKind, string>>> = {
  table: "TABLE",
  view: "VIEW",
  function: "FUNCTION",
  procedure: "PROCEDURE",
};

/** A default `information_schema` stores as the expression it is, so the design keeps it unquoted. */
const LITERAL_DEFAULT = /^(-?\d+(\.\d+)?|NULL|TRUE|FALSE|CURRENT_TIMESTAMP(\(\d*\))?)$/i;
/** MySQL 8 stores an expression default bare, such as `uuid()`; a `DEFAULT` clause takes it in parentheses. */
const EXPRESSION_DEFAULT = /^[A-Za-z_][A-Za-z0-9_]*\(.*\)$/s;

export interface MysqlObjectOptions {
  readonly name: (identifier: string) => string;
  readonly text: (value: string) => string;
}

/** Object DDL for MySQL. An alter is one `ALTER TABLE`, which MySQL applies whole or not at all. */
export function mysqlObjects(options: MysqlObjectOptions): ObjectEditor {
  const { name, text } = options;

  function columnDefinition(column: ColumnDesign): string {
    const fallback = (column.default ?? "").trim();
    return [
      name(column.name),
      column.type.trim(),
      column.nullable ? "NULL" : "NOT NULL",
      fallback === "" ? "" : `DEFAULT ${fallback}`,
      column.autoIncrement ? "AUTO_INCREMENT" : "",
      column.comment === null || column.comment === "" ? "" : `COMMENT ${text(column.comment)}`,
    ]
      .filter((part) => part !== "")
      .join(" ");
  }

  function columns(list: readonly string[]): string {
    return list.map(name).join(", ");
  }

  function index(entry: IndexDesign): string {
    return `${entry.unique ? "UNIQUE " : ""}INDEX ${name(entry.name)} (${columns(entry.columns)})`;
  }

  function foreignKey(key: ForeignKeyDesign, context: DdlContext): string {
    return `CONSTRAINT ${name(key.name)} ${referencesClause(key, context.qualifiedName(key.target.path, key.target.relation), name)}`;
  }

  function check(entry: CheckDesign): string {
    return `CONSTRAINT ${name(entry.name)} CHECK (${entry.expression.trim()})`;
  }

  function tableComment(value: string | null): string {
    return `COMMENT = ${text(value ?? "")}`;
  }

  function createTable(path: readonly string[], design: TableDesign, context: DdlContext): DdlScript {
    validateDesign(design);
    const parts = [
      ...design.columns.map(columnDefinition),
      ...(design.primaryKey.length > 0 ? [`PRIMARY KEY (${columns(design.primaryKey)})`] : []),
      ...design.indexes.map(index),
      ...design.foreignKeys.map((key) => foreignKey(key, context)),
      ...design.checks.map(check),
    ];
    const comment = design.comment === null || design.comment === "" ? "" : ` ${tableComment(design.comment)}`;
    return ddlScript(
      [
        `CREATE TABLE ${context.qualifiedName(path, design.name)} (\n${parts.map((part) => INDENT + part).join(",\n")}\n)${comment};`,
      ],
      { transactional: false, notes: [IMPLICIT_COMMIT_NOTE] },
    );
  }

  function alterTable(path: readonly string[], design: TableDesign, context: DdlContext): DdlScript {
    validateDesign(design);
    const current = context.current;
    if (current === null) throw designError("The table is not described; synchronize the data source and try again.");
    const difference = tableDifference(current, design);
    if (unchanged(difference)) return ddlScript([], { transactional: false, notes: [NOTHING_TO_CHANGE] });
    const table = context.qualifiedName(path, current.name);
    const clauses = [
      ...difference.droppedForeignKeys.map((key) => `DROP FOREIGN KEY ${name(key.name)}`),
      ...difference.droppedChecks.map((entry) => `DROP CHECK ${name(entry.name)}`),
      ...difference.droppedIndexes.map((entry) => `DROP INDEX ${name(entry.name)}`),
      ...(difference.primaryKeyChanged && current.primaryKey.length > 0 ? ["DROP PRIMARY KEY"] : []),
      ...difference.droppedColumns.map((column) => `DROP COLUMN ${name(column.name)}`),
      ...difference.changedColumns.map(
        ({ before, after }) => `CHANGE COLUMN ${name(before.name)} ${columnDefinition(after)}`,
      ),
      ...difference.addedColumns.map((column) => `ADD COLUMN ${columnDefinition(column)}`),
      ...(difference.primaryKeyChanged && design.primaryKey.length > 0
        ? [`ADD PRIMARY KEY (${columns(design.primaryKey)})`]
        : []),
      ...difference.addedIndexes.map((entry) => `ADD ${index(entry)}`),
      ...difference.addedChecks.map((entry) => `ADD ${check(entry)}`),
      ...difference.addedForeignKeys.map((key) => `ADD ${foreignKey(key, context)}`),
      ...(difference.commentChanged ? [tableComment(design.comment)] : []),
    ];
    const statements = [
      ...(clauses.length > 0 ? [`ALTER TABLE ${table}\n${clauses.map((clause) => INDENT + clause).join(",\n")};`] : []),
      ...(difference.renamedTo === null
        ? []
        : [`RENAME TABLE ${table} TO ${context.qualifiedName(path, difference.renamedTo)};`]),
    ];
    return ddlScript(statements, { transactional: false, notes: [IMPLICIT_COMMIT_NOTE] });
  }

  function keyword(kind: ObjectKind): string {
    const found = KEYWORDS[kind];
    if (found === undefined) throw designError(`MySQL has no ${kind} to change here.`);
    return found;
  }

  function script(change: ObjectChange, context: DdlContext): DdlScript {
    const notes = [IMPLICIT_COMMIT_NOTE];
    switch (change.kind) {
      case "createTable":
        return createTable(change.path, change.design, context);
      case "alterTable":
        return alterTable(change.path, change.design, context);
      case "rename": {
        if (change.name.trim() === "") throw designError("Type the new name.");
        if (change.object.kind !== "table" && change.object.kind !== "view") {
          throw designError("MySQL renames only tables and views; drop the routine and create it again.");
        }
        const from = context.qualifiedName(change.path, change.object.name);
        return ddlScript([`RENAME TABLE ${from} TO ${context.qualifiedName(change.path, change.name)};`], {
          transactional: false,
          notes,
        });
      }
      case "drop":
        return ddlScript(
          [`DROP ${keyword(change.object.kind)} ${context.qualifiedName(change.path, change.object.name)};`],
          { transactional: false, notes },
        );
      case "truncate":
        return ddlScript([`TRUNCATE TABLE ${context.qualifiedName(change.path, change.relation)};`], {
          transactional: false,
          notes,
        });
      case "createNamespace":
        if (change.name.trim() === "") throw designError("Name the database.");
        return ddlScript([`CREATE DATABASE ${name(change.name)};`], { transactional: false, notes });
    }
  }

  return {
    features: {
      types: TYPES,
      checks: true,
      comments: true,
      cascade: false,
      truncate: true,
      namespaceKind: "database",
      renamable: ["table", "view"],
      droppable: ["table", "view", "function", "procedure"],
    },
    design: (relation) =>
      tableDesignOf(relation, (column) => {
        if (column.default === null) return null;
        if (LITERAL_DEFAULT.test(column.default)) return column.default;
        if (EXPRESSION_DEFAULT.test(column.default)) return `(${column.default})`;
        return text(column.default);
      }),
    script,
  };
}
