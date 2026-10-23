import type { Relation } from "./catalog.js";

/** What the database tree can rename or drop (decision 052). */
export const OBJECT_KINDS = ["table", "view", "materializedView", "sequence", "function", "procedure"] as const;

export type ObjectKind = (typeof OBJECT_KINDS)[number];

/** One object in a namespace, named as the catalog names it. */
export interface CatalogObject {
  readonly kind: ObjectKind;
  readonly name: string;
}

/**
 * A column of a table design. `original` is the name the column has in the database, null for a
 * column the design adds, so a rename is told apart from a drop and an add.
 */
export interface ColumnDesign {
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
  /** A SQL expression, written as the column's `DEFAULT` clause takes it; null for none. */
  readonly default: string | null;
  readonly autoIncrement: boolean;
  readonly comment: string | null;
  readonly original: string | null;
}

export interface IndexDesign {
  readonly name: string;
  readonly columns: readonly string[];
  readonly unique: boolean;
  /** The index's name in the database, null for one the design adds. */
  readonly original: string | null;
}

export interface ForeignKeyDesign {
  readonly name: string;
  readonly columns: readonly string[];
  readonly target: { readonly path: readonly string[]; readonly relation: string; readonly columns: readonly string[] };
  /** The referential action as the dialect spells it, such as `CASCADE`; null for the default. */
  readonly onDelete: string | null;
  readonly onUpdate: string | null;
  readonly original: string | null;
}

export interface CheckDesign {
  readonly name: string;
  readonly expression: string;
  readonly original: string | null;
}

/** A table as the Create and Modify Table dialog edits it (decision 052). */
export interface TableDesign {
  readonly name: string;
  readonly comment: string | null;
  readonly columns: readonly ColumnDesign[];
  /** Column names in key order; empty for no primary key. */
  readonly primaryKey: readonly string[];
  /** The primary key constraint's name in the database, null when the table has none yet. */
  readonly primaryKeyName: string | null;
  readonly indexes: readonly IndexDesign[];
  readonly foreignKeys: readonly ForeignKeyDesign[];
  readonly checks: readonly CheckDesign[];
}

/** One change to the catalog of `path`, which the plugin turns into a `DdlScript`. */
export type ObjectChange =
  | { readonly kind: "createTable"; readonly path: readonly string[]; readonly design: TableDesign }
  | {
      readonly kind: "alterTable";
      readonly path: readonly string[];
      readonly relation: string;
      readonly design: TableDesign;
    }
  | {
      readonly kind: "rename";
      readonly path: readonly string[];
      readonly object: CatalogObject;
      readonly name: string;
    }
  | {
      readonly kind: "drop";
      readonly path: readonly string[];
      readonly object: CatalogObject;
      readonly cascade: boolean;
    }
  | {
      readonly kind: "truncate";
      readonly path: readonly string[];
      readonly relation: string;
      readonly cascade: boolean;
    }
  /** A schema or database inside `path`; `path` is empty for a top-level one. */
  | { readonly kind: "createNamespace"; readonly path: readonly string[]; readonly name: string };

export type ObjectChangeKind = ObjectChange["kind"];

/**
 * The statements for one change. The host runs `prepare` and `finish` outside any transaction on
 * the session it opens for the change, `statements` in one transaction when `transactional`, then
 * each of `verify`, which must return no row, before it commits.
 */
export interface DdlScript {
  readonly prepare: readonly string[];
  readonly statements: readonly string[];
  readonly verify: readonly string[];
  readonly finish: readonly string[];
  readonly transactional: boolean;
  /** What the preview tells the user before they run it, such as an implicit commit. */
  readonly notes: readonly string[];
}

/** What a dialect lets the tree and the table dialog offer; the UI reads these, never a plugin id. */
export interface ObjectFeatures {
  /** Column types the dialog suggests, most common first. */
  readonly types: readonly string[];
  readonly checks: boolean;
  readonly comments: boolean;
  /** Whether Drop and Truncate take `CASCADE`. */
  readonly cascade: boolean;
  readonly truncate: boolean;
  /** What New ▸ creates inside a namespace, or null when the dialect creates none. */
  readonly namespaceKind: "schema" | "database" | null;
  readonly renamable: readonly ObjectKind[];
  readonly droppable: readonly ObjectKind[];
}

/** What the host knows that a script needs: names as the introspector qualifies them, and the table as it is. */
export interface DdlContext {
  qualifiedName(path: readonly string[], name: string): string;
  /** For `alterTable`, the design of the table as the catalog describes it now; otherwise null. */
  readonly current: TableDesign | null;
}

/** Present exactly when the plugin declares `objects` (decision 052). Pure: it never runs SQL. */
export interface ObjectEditor {
  readonly features: ObjectFeatures;
  /** The design of a described table, every name its `original`. */
  design(relation: Relation): TableDesign;
  /**
   * The statements for `change`; an `alterTable` gets only the ones its difference from
   * `context.current` needs. Throws a `PluginError` coded `statementFailed` saying what to change
   * when the dialect cannot express it.
   */
  script(change: ObjectChange, context: DdlContext): DdlScript;
}
