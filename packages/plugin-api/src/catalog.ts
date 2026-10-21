/**
 * A database or schema: the unit the explorer lists, introspects and caches (decision 022).
 * `path` names it from the server down, such as `["table_craft", "public"]` on PostgreSQL.
 */
export interface Namespace {
  readonly path: readonly string[];
  readonly name: string;
  readonly kind: "database" | "schema";
  /** The database's own catalog, such as `pg_catalog`; hidden unless the user asks. */
  readonly system: boolean;
  /** Where unqualified names resolve for this connection. */
  readonly current: boolean;
}

export interface ColumnMeta {
  readonly name: string;
  /** 1-based, in table order. */
  readonly position: number;
  /** The type as the database spells it, such as `numeric(12,2)`. */
  readonly type: string;
  readonly nullable: boolean;
  /** The default expression as the database prints it; null when there is none. */
  readonly default: string | null;
  readonly comment: string | null;
  readonly autoIncrement: boolean;
}

export interface Key {
  readonly name: string;
  readonly columns: readonly string[];
}

export interface ForeignKey {
  readonly name: string;
  readonly columns: readonly string[];
  readonly target: {
    readonly path: readonly string[];
    readonly relation: string;
    readonly columns: readonly string[];
  };
  /** The referential action as SQL spells it, such as `CASCADE` or `NO ACTION`. */
  readonly onDelete: string;
  readonly onUpdate: string;
}

export interface Index {
  readonly name: string;
  readonly columns: readonly string[];
  readonly unique: boolean;
  readonly primary: boolean;
}

export type RelationKind = "table" | "view" | "materializedView";

export interface Relation {
  readonly name: string;
  readonly kind: RelationKind;
  readonly comment: string | null;
  /** Ordered by position. */
  readonly columns: readonly ColumnMeta[];
  readonly primaryKey: Key | null;
  readonly uniqueKeys: readonly Key[];
  readonly foreignKeys: readonly ForeignKey[];
  readonly indexes: readonly Index[];
}

export interface Routine {
  readonly name: string;
  readonly kind: "function" | "procedure";
}

export interface Sequence {
  readonly name: string;
}

/** Everything one `describe` returns; every list but `columns` is sorted by name. */
export interface NamespaceCatalog {
  readonly path: readonly string[];
  readonly relations: readonly Relation[];
  readonly routines: readonly Routine[];
  readonly sequences: readonly Sequence[];
}

/** Present on a session exactly when the plugin declares `schemaTree`. */
export interface Introspector {
  /** Every namespace the connection can see, system ones included and marked. */
  namespaces(): Promise<readonly Namespace[]>;
  /**
   * Rejects with a `PluginError` coded `introspectionFailed` when the namespace does not exist
   * or the user cannot read it.
   */
  describe(path: readonly string[]): Promise<NamespaceCatalog>;
  /** `name` inside `path`, quoted the way this database quotes identifiers. */
  qualifiedName(path: readonly string[], name: string): string;
}

/** Sorts by `name`, the order every catalog list but columns is returned in. */
export function byName<T extends { readonly name: string }>(items: Iterable<T>): T[] {
  return [...items].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
}
