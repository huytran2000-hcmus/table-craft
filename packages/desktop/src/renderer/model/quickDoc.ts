import type {
  ColumnMeta,
  ForeignKey,
  Index,
  Key,
  Relation,
  RelationKind,
} from "@table-craft/desktop/engine/protocol.js";
import { loadedRelations, pathKey, type DatasourceCatalog } from "@table-craft/desktop/renderer/model/explorerTree.js";

/** What Quick Documentation is asked about: a relation, or one of its columns. */
export interface QuickDocTarget {
  readonly datasourceId: string;
  readonly path: readonly string[];
  readonly relation: string;
  readonly column?: string;
}

/** A key mark beside a column: part of the primary key, or of a foreign key. */
export type ColumnMark = "primary" | "foreign";

export interface DocColumn {
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
  readonly default: string | null;
  readonly comment: string | null;
  readonly marks: readonly ColumnMark[];
}

/** A foreign key seen from the relation it is on (`outgoing`) or the one it points at (`incoming`). */
export interface DocForeignKey {
  readonly name: string;
  readonly columns: readonly string[];
  /** The other relation, qualified only when it lives in another namespace. */
  readonly other: string;
  readonly otherColumns: readonly string[];
}

export interface RelationDoc {
  readonly kind: "relation";
  readonly relationKind: RelationKind;
  readonly qualifiedName: string;
  readonly comment: string | null;
  readonly columns: readonly DocColumn[];
  readonly primaryKey: Key | null;
  readonly outgoing: readonly DocForeignKey[];
  readonly incoming: readonly DocForeignKey[];
  readonly indexes: readonly Index[];
}

export interface ColumnDoc {
  readonly kind: "column";
  readonly qualifiedName: string;
  readonly column: DocColumn;
  /** The keys and indexes the column is part of, by name. */
  readonly keys: readonly string[];
}

export type QuickDoc = RelationDoc | ColumnDoc;

export const RELATION_KIND_LABELS: Readonly<Record<RelationKind, string>> = {
  table: "Table",
  view: "View",
  materializedView: "Materialized view",
};

function qualified(path: readonly string[], name: string): string {
  return [...path, name].join(".");
}

function relationAt(
  catalog: DatasourceCatalog | undefined,
  path: readonly string[],
  name: string,
): Relation | undefined {
  return catalog?.namespaceStates[pathKey(path)]?.described?.catalog.relations.find(
    (relation) => relation.name === name,
  );
}

function marksOf(relation: Relation, column: ColumnMeta): readonly ColumnMark[] {
  const marks: ColumnMark[] = [];
  if (relation.primaryKey?.columns.includes(column.name) === true) marks.push("primary");
  if (relation.foreignKeys.some((key) => key.columns.includes(column.name))) marks.push("foreign");
  return marks;
}

function docColumn(relation: Relation, column: ColumnMeta): DocColumn {
  const { name, type, nullable, comment } = column;
  return { name, type, nullable, default: column.default, comment, marks: marksOf(relation, column) };
}

function otherName(home: readonly string[], path: readonly string[], relation: string): string {
  return pathKey(home) === pathKey(path) ? relation : qualified(path, relation);
}

function outgoing(path: readonly string[], key: ForeignKey): DocForeignKey {
  return {
    name: key.name,
    columns: key.columns,
    other: otherName(path, key.target.path, key.target.relation),
    otherColumns: key.target.columns,
  };
}

/** The foreign keys in any loaded namespace of the datasource that point at `relation`. */
function incoming(catalog: DatasourceCatalog, path: readonly string[], relation: string): readonly DocForeignKey[] {
  return loadedRelations({ catalog }).flatMap((source) =>
    source.relation.foreignKeys
      .filter((key) => key.target.relation === relation && pathKey(key.target.path) === pathKey(path))
      .map((key) => ({
        name: key.name,
        columns: key.target.columns,
        other: otherName(path, source.path, source.relation.name),
        otherColumns: key.columns,
      })),
  );
}

/**
 * Quick Documentation's content from the renderer's copy of the catalog (plan 010 decision 11);
 * null when the relation or column is not in it.
 */
export function quickDocOf(catalog: DatasourceCatalog | undefined, target: QuickDocTarget): QuickDoc | null {
  const relation = relationAt(catalog, target.path, target.relation);
  if (catalog === undefined || relation === undefined) return null;
  const qualifiedName = qualified(target.path, relation.name);
  if (target.column !== undefined) {
    const column = relation.columns.find((candidate) => candidate.name === target.column);
    if (column === undefined) return null;
    const keys = [
      ...(relation.primaryKey?.columns.includes(column.name) === true ? [relation.primaryKey.name] : []),
      ...relation.uniqueKeys.filter((key) => key.columns.includes(column.name)).map((key) => key.name),
      ...relation.foreignKeys.filter((key) => key.columns.includes(column.name)).map((key) => key.name),
      ...relation.indexes
        .filter((index) => !index.primary && index.columns.includes(column.name))
        .map((index) => index.name),
    ];
    return {
      kind: "column",
      qualifiedName: `${qualifiedName}.${column.name}`,
      column: docColumn(relation, column),
      keys: [...new Set(keys)],
    };
  }
  return {
    kind: "relation",
    relationKind: relation.kind,
    qualifiedName,
    comment: relation.comment,
    columns: relation.columns.map((column) => docColumn(relation, column)),
    primaryKey: relation.primaryKey,
    outgoing: relation.foreignKeys.map((key) => outgoing(target.path, key)),
    incoming: incoming(catalog, target.path, relation.name),
    indexes: relation.indexes.filter((index) => !index.primary),
  };
}
