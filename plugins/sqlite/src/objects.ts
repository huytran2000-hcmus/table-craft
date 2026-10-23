import type {
  CheckDesign,
  ColumnDesign,
  DdlContext,
  DdlScript,
  ForeignKeyDesign,
  IndexDesign,
  ObjectChange,
  ObjectEditor,
  Relation,
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
  type TableDifference,
} from "@table-craft/plugin-api/sql";

const INDENT = "  ";
const TYPES = ["INTEGER", "TEXT", "REAL", "NUMERIC", "BLOB", "BOOLEAN", "DATE", "TIMESTAMP"];
/** Only `INTEGER PRIMARY KEY` aliases the rowid (https://sqlite.org/lang_createtable.html#rowid). */
const ROWID_TYPE = /^INTEGER$/i;
/** `ADD COLUMN` refuses a default in parentheses or a current time (https://sqlite.org/lang_altertable.html). */
const NON_CONSTANT_DEFAULT = /^\(|^CURRENT_(TIME|DATE|TIMESTAMP)\b/i;
/** The suffix the rebuild's new table carries until it takes the old one's name. */
const REBUILD_SUFFIX = "__table_craft_new";

/** Foreign keys are off while the old table is dropped, so its rows' references hold (https://sqlite.org/lang_altertable.html#otheralter). */
const FOREIGN_KEYS_OFF = "PRAGMA foreign_keys = OFF";
const FOREIGN_KEYS_ON = "PRAGMA foreign_keys = ON";

export const REBUILD_NOTE =
  "SQLite cannot make this change in place, so the table is rebuilt: a new table is created, the rows are copied into it, the old table is dropped and the new one renamed. Its triggers and checks are dropped with the old table, and its indexes are created again from their columns.";

export interface SqliteObjectOptions {
  readonly name: (identifier: string) => string;
}

/** The name the design gives the index behind a `UNIQUE` constraint, which SQLite names internally. */
function uniqueKeyIndexName(table: string, columns: readonly string[]): string {
  return `${table}_${columns.join("_")}_key`;
}

/** Object DDL for SQLite. What `ALTER TABLE` cannot do is the documented twelve-step rebuild (decision 053). */
export function sqliteObjects(options: SqliteObjectOptions): ObjectEditor {
  const { name } = options;

  function columns(list: readonly string[]): string {
    return list.map(name).join(", ");
  }

  function rowidColumn(design: TableDesign): ColumnDesign | null {
    const marked = design.columns.filter((column) => column.autoIncrement);
    const [only] = marked;
    if (only === undefined) return null;
    if (marked.length > 1 || design.primaryKey.length !== 1 || design.primaryKey[0] !== only.name) {
      throw designError("In SQLite only a lone INTEGER primary key column auto-increments; make it the primary key.");
    }
    if (!ROWID_TYPE.test(only.type.trim())) throw designError(`Give auto-increment column ${only.name} type INTEGER.`);
    return only;
  }

  function columnDefinition(column: ColumnDesign, rowid: boolean): string {
    const fallback = (column.default ?? "").trim();
    return [
      name(column.name),
      column.type.trim(),
      rowid ? "PRIMARY KEY" : "",
      column.nullable || rowid ? "" : "NOT NULL",
      fallback === "" ? "" : `DEFAULT ${fallback}`,
    ]
      .filter((part) => part !== "")
      .join(" ");
  }

  function foreignKey(key: ForeignKeyDesign): string {
    // A SQLite foreign key names its target without a schema: the target is in the same database.
    return `CONSTRAINT ${name(key.name)} ${referencesClause(key, name(key.target.relation), name)}`;
  }

  function check(entry: CheckDesign): string {
    return `CONSTRAINT ${name(entry.name)} CHECK (${entry.expression.trim()})`;
  }

  function createIndex(path: readonly string[], index: IndexDesign, table: string, context: DdlContext): string {
    return `CREATE ${index.unique ? "UNIQUE " : ""}INDEX ${context.qualifiedName(path, index.name)} ON ${name(table)} (${columns(index.columns)});`;
  }

  function createTableStatement(qualified: string, design: TableDesign): string {
    const rowid = rowidColumn(design);
    const parts = [
      ...design.columns.map((column) => columnDefinition(column, column === rowid)),
      ...(design.primaryKey.length > 0 && rowid === null ? [`PRIMARY KEY (${columns(design.primaryKey)})`] : []),
      ...design.foreignKeys.map(foreignKey),
      ...design.checks.map(check),
    ];
    return `CREATE TABLE ${qualified} (\n${parts.map((part) => INDENT + part).join(",\n")}\n);`;
  }

  function createTable(path: readonly string[], design: TableDesign, context: DdlContext): DdlScript {
    validateDesign(design);
    return ddlScript(
      [
        createTableStatement(context.qualifiedName(path, design.name), design),
        ...design.indexes.map((index) => createIndex(path, index, design.name, context)),
      ],
      { transactional: true },
    );
  }

  /** Whether `ALTER TABLE` and index statements make the whole change, which leaves rows and triggers alone. */
  function inPlace(current: TableDesign, difference: TableDifference): boolean {
    const keyed = new Set([
      ...current.primaryKey,
      ...current.indexes.flatMap((index) => index.columns),
      ...current.foreignKeys.flatMap((key) => key.columns),
    ]);
    return (
      !difference.primaryKeyChanged &&
      !difference.commentChanged &&
      difference.addedForeignKeys.length === 0 &&
      difference.droppedForeignKeys.length === 0 &&
      difference.addedChecks.length === 0 &&
      difference.droppedChecks.length === 0 &&
      difference.changedColumns.every(
        ({ before, after }) => before.name !== after.name && sameDefinition(before, after),
      ) &&
      difference.droppedColumns.every((column) => !keyed.has(column.name)) &&
      difference.addedColumns.every(
        (column) =>
          !column.autoIncrement &&
          (column.nullable || (column.default ?? "").trim() !== "") &&
          !NON_CONSTANT_DEFAULT.test((column.default ?? "").trim()),
      ) &&
      difference.droppedIndexes.every((index) => index.name !== uniqueKeyIndexName(current.name, index.columns))
    );
  }

  function sameDefinition(before: ColumnDesign, after: ColumnDesign): boolean {
    return (
      before.type.trim() === after.type.trim() &&
      before.nullable === after.nullable &&
      (before.default ?? "").trim() === (after.default ?? "").trim() &&
      before.autoIncrement === after.autoIncrement
    );
  }

  function alterInPlace(
    path: readonly string[],
    current: TableDesign,
    design: TableDesign,
    difference: TableDifference,
    context: DdlContext,
  ): DdlScript {
    const table = context.qualifiedName(path, current.name);
    const alter = (clause: string): string => `ALTER TABLE ${table} ${clause};`;
    const finalName = difference.renamedTo ?? current.name;
    return ddlScript(
      [
        ...difference.droppedIndexes.map((index) => `DROP INDEX ${context.qualifiedName(path, index.name)};`),
        ...difference.droppedColumns.map((column) => alter(`DROP COLUMN ${name(column.name)}`)),
        ...difference.changedColumns.map(({ before, after }) =>
          alter(`RENAME COLUMN ${name(before.name)} TO ${name(after.name)}`),
        ),
        ...difference.addedColumns.map((column) => alter(`ADD COLUMN ${columnDefinition(column, false)}`)),
        ...(difference.renamedTo === null ? [] : [alter(`RENAME TO ${name(difference.renamedTo)}`)]),
        ...difference.addedIndexes.map((index) => createIndex(path, index, finalName, context)),
      ],
      { transactional: true },
    );
  }

  function rebuild(path: readonly string[], current: TableDesign, design: TableDesign, context: DdlContext): DdlScript {
    const old = context.qualifiedName(path, current.name);
    const temporary = `${design.name}${REBUILD_SUFFIX}`;
    const copied = design.columns.filter((column) => column.original !== null);
    const [schema = ""] = path;
    return ddlScript(
      [
        createTableStatement(context.qualifiedName(path, temporary), design),
        ...(copied.length > 0
          ? [
              `INSERT INTO ${context.qualifiedName(path, temporary)} (${columns(copied.map((column) => column.name))})\nSELECT ${columns(
                copied.map((column) => column.original ?? column.name),
              )}\nFROM ${old};`,
            ]
          : []),
        `DROP TABLE ${old};`,
        `ALTER TABLE ${context.qualifiedName(path, temporary)} RENAME TO ${name(design.name)};`,
        ...design.indexes.map((index) => createIndex(path, index, design.name, context)),
      ],
      {
        transactional: true,
        prepare: [FOREIGN_KEYS_OFF],
        verify: [`PRAGMA ${name(schema)}.foreign_key_check(${name(design.name)})`],
        finish: [FOREIGN_KEYS_ON],
        notes: [REBUILD_NOTE],
      },
    );
  }

  function alterTable(path: readonly string[], design: TableDesign, context: DdlContext): DdlScript {
    validateDesign(design);
    rowidColumn(design);
    const current = context.current;
    if (current === null) throw designError("The table is not described; synchronize the data source and try again.");
    const difference = tableDifference(current, design);
    if (unchanged(difference)) return ddlScript([], { transactional: true, notes: [NOTHING_TO_CHANGE] });
    return inPlace(current, difference)
      ? alterInPlace(path, current, design, difference, context)
      : rebuild(path, current, design, context);
  }

  function script(change: ObjectChange, context: DdlContext): DdlScript {
    switch (change.kind) {
      case "createTable":
        return createTable(change.path, change.design, context);
      case "alterTable":
        return alterTable(change.path, change.design, context);
      case "rename":
        if (change.name.trim() === "") throw designError("Type the new name.");
        if (change.object.kind !== "table") {
          throw designError("SQLite renames only tables; drop the view and create it again under the new name.");
        }
        return ddlScript(
          [`ALTER TABLE ${context.qualifiedName(change.path, change.object.name)} RENAME TO ${name(change.name)};`],
          { transactional: true },
        );
      case "drop": {
        if (change.object.kind !== "table" && change.object.kind !== "view") {
          throw designError(`SQLite has no ${change.object.kind} to drop.`);
        }
        const keyword = change.object.kind === "table" ? "TABLE" : "VIEW";
        return ddlScript([`DROP ${keyword} ${context.qualifiedName(change.path, change.object.name)};`], {
          transactional: true,
        });
      }
      case "truncate":
        // SQLite has no TRUNCATE; a DELETE without WHERE takes the truncate optimisation.
        return ddlScript([`DELETE FROM ${context.qualifiedName(change.path, change.relation)};`], {
          transactional: true,
        });
      case "createNamespace":
        throw designError("SQLite attaches databases rather than creating schemas; attach a file in the data source.");
    }
  }

  function design(relation: Relation): TableDesign {
    const uniqueKeys = new Set(relation.uniqueKeys.map((key) => key.name));
    const base = tableDesignOf(relation);
    return {
      ...base,
      indexes: base.indexes.map((index) => {
        if (!uniqueKeys.has(index.name)) return index;
        const generated = uniqueKeyIndexName(relation.name, index.columns);
        return { ...index, name: generated, original: generated };
      }),
    };
  }

  return {
    features: {
      types: TYPES,
      checks: true,
      comments: false,
      cascade: false,
      truncate: true,
      namespaceKind: null,
      renamable: ["table"],
      droppable: ["table", "view"],
    },
    design,
    script,
  };
}
