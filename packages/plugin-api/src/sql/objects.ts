import {
  PluginError,
  type CheckDesign,
  type ColumnDesign,
  type DdlScript,
  type ForeignKeyDesign,
  type IndexDesign,
  type Relation,
  type TableDesign,
} from "@table-craft/plugin-api";

/** The action a dialect applies when a foreign key names none, which a design leaves null. */
const DEFAULT_ACTIONS = new Set(["NO ACTION", "RESTRICT"]);

/** The referential actions a design may name, as SQL spells them. */
export const REFERENTIAL_ACTIONS = ["CASCADE", "SET NULL", "SET DEFAULT", "RESTRICT", "NO ACTION"] as const;

/** A failure the user fixes in the dialog, so the host shows it as the dialog's error. */
export function designError(message: string): PluginError {
  return new PluginError("statementFailed", message);
}

/**
 * The design of a described table (decision 052). `columnDefault` turns the catalog's default into
 * the expression a `DEFAULT` clause takes, for a dialect whose catalog stores it otherwise.
 */
export function tableDesignOf(
  relation: Relation,
  columnDefault: (column: Relation["columns"][number]) => string | null = (column) => column.default,
): TableDesign {
  const primary = new Set(relation.primaryKey === null ? [] : [relation.primaryKey.name]);
  return {
    name: relation.name,
    comment: relation.comment,
    columns: relation.columns.map((column): ColumnDesign => ({
      name: column.name,
      type: column.type,
      nullable: column.nullable,
      default: columnDefault(column),
      autoIncrement: column.autoIncrement,
      comment: column.comment,
      original: column.name,
    })),
    primaryKey: relation.primaryKey?.columns ?? [],
    primaryKeyName: relation.primaryKey?.name ?? null,
    indexes: relation.indexes
      .filter((index) => !index.primary && !primary.has(index.name))
      .map((index): IndexDesign => ({
        name: index.name,
        columns: index.columns,
        unique: index.unique,
        original: index.name,
      })),
    foreignKeys: relation.foreignKeys.map((key): ForeignKeyDesign => ({
      name: key.name,
      columns: key.columns,
      target: key.target,
      onDelete: referentialAction(key.onDelete),
      onUpdate: referentialAction(key.onUpdate),
      original: key.name,
    })),
    checks: [],
  };
}

function referentialAction(action: string): string | null {
  const spelled = action.toUpperCase();
  return DEFAULT_ACTIONS.has(spelled) ? null : spelled;
}

function trimmed(text: string): string {
  return text.trim();
}

/** Throws a `designError` naming the first thing in `design` no dialect can create. */
export function validateDesign(design: TableDesign): void {
  if (trimmed(design.name) === "") throw designError("Name the table.");
  if (design.columns.length === 0) throw designError("Add a column: a table needs at least one.");
  const names = new Set<string>();
  for (const column of design.columns) {
    if (trimmed(column.name) === "") throw designError("Name every column.");
    if (names.has(column.name)) throw designError(`Two columns are named ${column.name}; rename one.`);
    if (trimmed(column.type) === "") throw designError(`Give column ${column.name} a type.`);
    names.add(column.name);
  }
  const known = (columns: readonly string[], what: string): void => {
    if (columns.length === 0) throw designError(`Pick the columns of ${what}.`);
    const missing = columns.find((column) => !names.has(column));
    if (missing !== undefined) throw designError(`${what} names column ${missing}, which the table does not have.`);
  };
  if (design.primaryKey.length > 0) known(design.primaryKey, "The primary key");
  for (const index of design.indexes) {
    if (trimmed(index.name) === "") throw designError("Name every index.");
    known(index.columns, `Index ${index.name}`);
  }
  for (const key of design.foreignKeys) {
    if (trimmed(key.name) === "") throw designError("Name every foreign key.");
    known(key.columns, `Foreign key ${key.name}`);
    if (trimmed(key.target.relation) === "") throw designError(`Pick the table foreign key ${key.name} references.`);
    for (const action of [key.onDelete, key.onUpdate]) {
      if (action !== null && !REFERENTIAL_ACTIONS.some((known) => known === action)) {
        throw designError(
          `Foreign key ${key.name} names action ${action}; pick one of ${REFERENTIAL_ACTIONS.join(", ")}.`,
        );
      }
    }
    if (key.target.columns.length !== key.columns.length) {
      throw designError(`Foreign key ${key.name} needs as many referenced columns as it has columns.`);
    }
  }
  for (const check of design.checks) {
    if (trimmed(check.name) === "") throw designError("Name every check.");
    if (trimmed(check.expression) === "") throw designError(`Give check ${check.name} an expression.`);
  }
}

/** What an `alterTable` changes, each part matched by its `original` name. */
export interface TableDifference {
  readonly renamedTo: string | null;
  readonly commentChanged: boolean;
  readonly droppedColumns: readonly ColumnDesign[];
  readonly addedColumns: readonly ColumnDesign[];
  /** A column whose name or definition differs; `before` is as the table has it now. */
  readonly changedColumns: readonly { readonly before: ColumnDesign; readonly after: ColumnDesign }[];
  readonly primaryKeyChanged: boolean;
  readonly droppedIndexes: readonly IndexDesign[];
  readonly addedIndexes: readonly IndexDesign[];
  readonly droppedForeignKeys: readonly ForeignKeyDesign[];
  readonly addedForeignKeys: readonly ForeignKeyDesign[];
  readonly droppedChecks: readonly CheckDesign[];
  readonly addedChecks: readonly CheckDesign[];
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function sameIndex(left: IndexDesign, right: IndexDesign): boolean {
  return left.name === right.name && left.unique === right.unique && sameList(left.columns, right.columns);
}

function sameForeignKey(left: ForeignKeyDesign, right: ForeignKeyDesign): boolean {
  return (
    left.name === right.name &&
    sameList(left.columns, right.columns) &&
    sameList(left.target.path, right.target.path) &&
    left.target.relation === right.target.relation &&
    sameList(left.target.columns, right.target.columns) &&
    left.onDelete === right.onDelete &&
    left.onUpdate === right.onUpdate
  );
}

function sameCheck(left: CheckDesign, right: CheckDesign): boolean {
  return left.name === right.name && left.expression.trim() === right.expression.trim();
}

/** Whether a column's definition, everything but its name, differs. */
export function columnChanged(before: ColumnDesign, after: ColumnDesign): boolean {
  return (
    before.type.trim() !== after.type.trim() ||
    before.nullable !== after.nullable ||
    (before.default ?? "").trim() !== (after.default ?? "").trim() ||
    before.autoIncrement !== after.autoIncrement ||
    (before.comment ?? "") !== (after.comment ?? "")
  );
}

/**
 * Parts matched by `original`: one whose original is gone from `after` was dropped, one without an
 * original was added, and a changed index, key or check is dropped and added again.
 */
function partsDiff<Part extends { readonly name: string; readonly original: string | null }>(
  before: readonly Part[],
  after: readonly Part[],
  same: (left: Part, right: Part) => boolean,
): { readonly dropped: readonly Part[]; readonly added: readonly Part[] } {
  const kept = new Map(after.filter((part) => part.original !== null).map((part) => [part.original, part]));
  const dropped: Part[] = [];
  const added: Part[] = after.filter((part) => part.original === null);
  for (const part of before) {
    const next = kept.get(part.name);
    if (next === undefined) dropped.push(part);
    else if (!same(part, next)) {
      dropped.push(part);
      added.push(next);
    }
  }
  return { dropped, added };
}

export function tableDifference(before: TableDesign, after: TableDesign): TableDifference {
  const byOriginal = new Map(after.columns.filter((column) => column.original !== null).map((c) => [c.original, c]));
  const changedColumns: { before: ColumnDesign; after: ColumnDesign }[] = [];
  const droppedColumns: ColumnDesign[] = [];
  for (const column of before.columns) {
    const next = byOriginal.get(column.name);
    if (next === undefined) droppedColumns.push(column);
    else if (next.name !== column.name || columnChanged(column, next)) {
      changedColumns.push({ before: column, after: next });
    }
  }
  const indexes = partsDiff(before.indexes, after.indexes, sameIndex);
  const foreignKeys = partsDiff(before.foreignKeys, after.foreignKeys, sameForeignKey);
  const checks = partsDiff(before.checks, after.checks, sameCheck);
  return {
    renamedTo: after.name === before.name ? null : after.name,
    commentChanged: (before.comment ?? "") !== (after.comment ?? ""),
    droppedColumns,
    addedColumns: after.columns.filter((column) => column.original === null),
    changedColumns,
    primaryKeyChanged: !sameList(before.primaryKey, after.primaryKey),
    droppedIndexes: indexes.dropped,
    addedIndexes: indexes.added,
    droppedForeignKeys: foreignKeys.dropped,
    addedForeignKeys: foreignKeys.added,
    droppedChecks: checks.dropped,
    addedChecks: checks.added,
  };
}

/** Whether a difference holds no change at all. */
export function unchanged(difference: TableDifference): boolean {
  return (
    difference.renamedTo === null &&
    !difference.commentChanged &&
    !difference.primaryKeyChanged &&
    [
      difference.droppedColumns,
      difference.addedColumns,
      difference.changedColumns,
      difference.droppedIndexes,
      difference.addedIndexes,
      difference.droppedForeignKeys,
      difference.addedForeignKeys,
      difference.droppedChecks,
      difference.addedChecks,
    ].every((parts) => parts.length === 0)
  );
}

/** A script of `statements` with nothing around them. */
export function ddlScript(
  statements: readonly string[],
  options: Partial<Omit<DdlScript, "statements">> & Pick<DdlScript, "transactional">,
): DdlScript {
  return {
    prepare: options.prepare ?? [],
    statements,
    verify: options.verify ?? [],
    finish: options.finish ?? [],
    transactional: options.transactional,
    notes: options.notes ?? [],
  };
}

/** `NOTHING_TO_CHANGE` is the note an alter without a difference carries, so the dialog can say so. */
export const NOTHING_TO_CHANGE = "The design matches the table; there is nothing to run.";

/** The `REFERENCES` tail of a foreign key, actions only where they differ from the default. */
export function referencesClause(
  key: ForeignKeyDesign,
  qualifiedTarget: string,
  name: (identifier: string) => string,
): string {
  const actions = [
    key.onDelete === null ? "" : ` ON DELETE ${key.onDelete}`,
    key.onUpdate === null ? "" : ` ON UPDATE ${key.onUpdate}`,
  ].join("");
  return `FOREIGN KEY (${key.columns.map(name).join(", ")}) REFERENCES ${qualifiedTarget} (${key.target.columns
    .map(name)
    .join(", ")})${actions}`;
}
