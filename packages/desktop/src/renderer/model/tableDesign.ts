import type {
  ColumnDesign,
  DdlScript,
  ForeignKeyDesign,
  IndexDesign,
  TableDesign,
} from "@table-craft/desktop/engine/protocol.js";

const FIRST_COLUMN = "id";
const NEW_COLUMN_PREFIX = "column_";
const LIST_SEPARATOR = ",";
const STATEMENT_END = ";";

/** A new table's starting design: one non-null key column of the dialect's first suggested type. */
export function emptyDesign(name: string, types: readonly string[]): TableDesign {
  return {
    name,
    comment: null,
    columns: [newColumnDesign(FIRST_COLUMN, types[0] ?? "", false)],
    primaryKey: [FIRST_COLUMN],
    primaryKeyName: null,
    indexes: [],
    foreignKeys: [],
    checks: [],
  };
}

function newColumnDesign(name: string, type: string, nullable: boolean): ColumnDesign {
  return { name, type, nullable, default: null, autoIncrement: false, comment: null, original: null };
}

/** Appends a nullable column named `column_N` with the first N no column uses. */
export function addColumn(design: TableDesign, type: string): TableDesign {
  const names = new Set(design.columns.map((column) => column.name));
  let next = design.columns.length + 1;
  while (names.has(`${NEW_COLUMN_PREFIX}${String(next)}`)) next += 1;
  return {
    ...design,
    columns: [...design.columns, newColumnDesign(`${NEW_COLUMN_PREFIX}${String(next)}`, type, true)],
  };
}

function renamed(columns: readonly string[], from: string, to: string): readonly string[] {
  return columns.map((column) => (column === from ? to : column));
}

/**
 * Changes one column; a new name follows into the key, indexes and foreign keys that list it, so
 * renaming a column never silently drops it from a constraint.
 */
export function setColumn(design: TableDesign, index: number, patch: Partial<ColumnDesign>): TableDesign {
  const before = design.columns[index];
  if (before === undefined) return design;
  const after = { ...before, ...patch };
  const columns = design.columns.map((column, at) => (at === index ? after : column));
  if (after.name === before.name) return { ...design, columns };
  const from = before.name;
  const to = after.name;
  return {
    ...design,
    columns,
    primaryKey: renamed(design.primaryKey, from, to),
    indexes: design.indexes.map((entry) => ({ ...entry, columns: renamed(entry.columns, from, to) })),
    foreignKeys: design.foreignKeys.map((key) => ({ ...key, columns: renamed(key.columns, from, to) })),
  };
}

/** Removes a column and every constraint left with no column. */
export function removeColumn(design: TableDesign, index: number): TableDesign {
  const removed = design.columns[index];
  if (removed === undefined) return design;
  const keep = (columns: readonly string[]) => columns.filter((column) => column !== removed.name);
  return {
    ...design,
    columns: design.columns.filter((_column, at) => at !== index),
    primaryKey: keep(design.primaryKey),
    indexes: design.indexes
      .map((entry) => ({ ...entry, columns: keep(entry.columns) }))
      .filter((entry) => entry.columns.length > 0),
    foreignKeys: design.foreignKeys.filter((key) => !key.columns.includes(removed.name)),
  };
}

/** Moves a column one place up (-1) or down (1); a no-op at either end. */
export function moveColumn(design: TableDesign, index: number, step: -1 | 1): TableDesign {
  const target = index + step;
  const moving = design.columns[index];
  const other = design.columns[target];
  if (moving === undefined || other === undefined) return design;
  const columns = [...design.columns];
  columns[index] = other;
  columns[target] = moving;
  return { ...design, columns };
}

/** Puts the column in the primary key, in table order, or takes it out; a key column is not null. */
export function setPrimaryKey(design: TableDesign, name: string, member: boolean): TableDesign {
  const primaryKey = member
    ? design.columns
        .map((column) => column.name)
        .filter((column) => column === name || design.primaryKey.includes(column))
    : design.primaryKey.filter((column) => column !== name);
  const columns = member
    ? design.columns.map((column) => (column.name === name ? { ...column, nullable: false } : column))
    : design.columns;
  return { ...design, primaryKey, columns };
}

export function newIndex(design: TableDesign): IndexDesign {
  return { name: `${design.name}_idx${String(design.indexes.length + 1)}`, columns: [], unique: false, original: null };
}

export function newForeignKey(design: TableDesign, path: readonly string[]): ForeignKeyDesign {
  return {
    name: `${design.name}_fk${String(design.foreignKeys.length + 1)}`,
    columns: [],
    target: { path, relation: "", columns: [] },
    onDelete: null,
    onUpdate: null,
    original: null,
  };
}

/** A column list as the dialog's text field shows it. */
export function listText(columns: readonly string[]): string {
  return columns.join(`${LIST_SEPARATOR} `);
}

/** A typed column list: comma-separated, trimmed, blanks dropped. */
export function parseList(text: string): readonly string[] {
  return text
    .split(LIST_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

function duplicateOf(names: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) return name;
    seen.add(name);
  }
  return null;
}

/**
 * What stops the design from being previewed, said so it can be fixed; null when the plugin can be
 * asked. The plugin checks again, and alone knows the dialect's rules.
 */
export function designProblem(design: TableDesign): string | null {
  if (design.name.trim() === "") return "Name the table.";
  if (design.columns.length === 0) return "Add at least one column.";
  const unnamed = design.columns.findIndex((column) => column.name.trim() === "");
  if (unnamed >= 0) return `Name column ${String(unnamed + 1)}.`;
  const untyped = design.columns.find((column) => column.type.trim() === "");
  if (untyped !== undefined) return `Give ${untyped.name} a type.`;
  const duplicate = duplicateOf(design.columns.map((column) => column.name));
  if (duplicate !== null) return `Two columns are named ${duplicate}.`;
  const names = new Set(design.columns.map((column) => column.name));
  for (const entry of design.indexes) {
    if (entry.columns.length === 0) return `Index ${entry.name} lists no column.`;
    const unknown = entry.columns.find((column) => !names.has(column));
    if (unknown !== undefined) return `Index ${entry.name} lists ${unknown}, which is not a column.`;
  }
  for (const key of design.foreignKeys) {
    if (key.target.relation === "") return `Choose the table foreign key ${key.name} references.`;
    if (key.columns.length === 0) return `Foreign key ${key.name} lists no column.`;
    if (key.columns.length !== key.target.columns.length) {
      return `Foreign key ${key.name} lists ${String(key.columns.length)} columns but references ${String(key.target.columns.length)}.`;
    }
  }
  for (const check of design.checks) {
    if (check.expression.trim() === "") return `Check ${check.name} has no expression.`;
  }
  return null;
}

function terminated(statement: string): string {
  return statement.trimEnd().endsWith(STATEMENT_END) ? statement : `${statement}${STATEMENT_END}`;
}

/**
 * Everything the change runs, in order, as one script: what the preview shows and what Open in
 * Console pastes. The engine wraps `statements` in its transaction; the script does not, so a
 * console runs it the way the console's own mode says.
 */
export function scriptText(script: DdlScript): string {
  return [...script.prepare, ...script.statements, ...script.verify, ...script.finish].map(terminated).join("\n\n");
}

/** What the preview says about how the script runs, after the plugin's own notes. */
export function scriptNotes(script: DdlScript): readonly string[] {
  if (script.statements.length === 0) return script.notes;
  return script.transactional
    ? [...script.notes, "Runs in one transaction: if a statement fails, nothing is changed."]
    : script.notes;
}
