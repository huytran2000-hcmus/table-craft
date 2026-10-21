import type pg from "pg";
import {
  byName,
  PluginError,
  type ColumnMeta,
  type ForeignKey,
  type Index,
  type Introspector,
  type Key,
  type Namespace,
  type NamespaceCatalog,
  type Relation,
  type RelationKind,
  type Routine,
  type Sequence,
} from "@table-craft/plugin-api";

const SYSTEM_SCHEMAS: ReadonlySet<string> = new Set(["information_schema", "pg_catalog", "pg_toast"]);

/** `pg_class.relkind` letters, from `pg_class.h` in the PostgreSQL source. */
const RELATION_KINDS: ReadonlyMap<string, RelationKind> = new Map([
  ["r", "table"],
  ["p", "table"],
  ["f", "table"],
  ["v", "view"],
  ["m", "materializedView"],
]);
const RELKINDS_SQL = [...RELATION_KINDS.keys()].map((kind) => `'${kind}'`).join(", ");

/** `pg_constraint.confdeltype` and `confupdtype` letters. */
const REFERENTIAL_ACTIONS: ReadonlyMap<string, string> = new Map([
  ["a", "NO ACTION"],
  ["r", "RESTRICT"],
  ["c", "CASCADE"],
  ["n", "SET NULL"],
  ["d", "SET DEFAULT"],
]);
const DEFAULT_ACTION = "NO ACTION";

/** `pg_proc.prokind` letter for a procedure; functions, aggregates and window functions are functions. */
const PROCEDURE_KIND = "p";

const IDENTITY_NONE = "";
const SERIAL_DEFAULT_PREFIX = "nextval(";

/**
 * Per-session temporary schemas come and go with other connections; nobody browses them.
 * `pg_temp_3` and `pg_toast_temp_3` are what the server names them.
 */
const TEMPORARY_SCHEMA = /^pg_(toast_)?temp_\d+$/;

const NAMESPACES_SQL = `
  SELECT current_database() AS database, current_schema() AS current, n.nspname AS name
  FROM pg_namespace n
  ORDER BY n.nspname`;

const SCHEMA_SQL = `
  SELECT n.oid::int8::text AS oid, has_schema_privilege(n.oid, 'USAGE') AS usable
  FROM pg_namespace n
  WHERE n.nspname = $1`;

const RELATIONS_SQL = `
  SELECT c.relname AS name, c.relkind AS kind, obj_description(c.oid, 'pg_class') AS comment
  FROM pg_class c
  WHERE c.relnamespace = $1::oid AND c.relkind IN (${RELKINDS_SQL})`;

const COLUMNS_SQL = `
  SELECT c.relname AS relation, a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
    NOT a.attnotnull AS nullable, pg_get_expr(d.adbin, d.adrelid) AS default,
    col_description(a.attrelid, a.attnum) AS comment, a.attidentity AS identity
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE c.relnamespace = $1::oid AND c.relkind IN (${RELKINDS_SQL}) AND a.attnum > 0 AND NOT a.attisdropped
  ORDER BY c.relname, a.attnum`;

const CONSTRAINTS_SQL = `
  SELECT c.relname AS relation, con.conname AS name, con.contype AS type,
    (SELECT json_agg(a.attname ORDER BY k.ord) FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS columns,
    tn.nspname AS target_schema, tc.relname AS target_relation,
    (SELECT json_agg(a.attname ORDER BY k.ord) FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum) AS target_columns,
    con.confdeltype AS on_delete, con.confupdtype AS on_update
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  LEFT JOIN pg_class tc ON tc.oid = con.confrelid
  LEFT JOIN pg_namespace tn ON tn.oid = tc.relnamespace
  WHERE c.relnamespace = $1::oid AND con.contype IN ('p', 'u', 'f')`;

/** An expression column has `attnum` 0; `pg_get_indexdef` prints its expression instead. */
const INDEXES_SQL = `
  SELECT t.relname AS relation, i.relname AS name, ix.indisunique AS unique, ix.indisprimary AS primary,
    (SELECT json_agg(COALESCE(a.attname, pg_get_indexdef(ix.indexrelid, k.ord::int, true)) ORDER BY k.ord)
      FROM unnest(ix.indkey::int2[]) WITH ORDINALITY k(attnum, ord)
      LEFT JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum AND k.attnum <> 0) AS columns
  FROM pg_index ix
  JOIN pg_class i ON i.oid = ix.indexrelid
  JOIN pg_class t ON t.oid = ix.indrelid
  WHERE t.relnamespace = $1::oid`;

const ROUTINES_SQL = `
  SELECT DISTINCT ON (p.proname) p.proname AS name, p.prokind AS kind
  FROM pg_proc p
  WHERE p.pronamespace = $1::oid
  ORDER BY p.proname, p.prokind`;

const SEQUENCES_SQL = `
  SELECT c.relname AS name FROM pg_class c WHERE c.relnamespace = $1::oid AND c.relkind = 'S'`;

interface NamespaceRow {
  readonly database: string;
  readonly current: string | null;
  readonly name: string;
}

interface SchemaRow {
  readonly oid: string;
  readonly usable: boolean;
}

interface RelationRow {
  readonly name: string;
  readonly kind: string;
  readonly comment: string | null;
}

interface ColumnRow {
  readonly relation: string;
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
  readonly default: string | null;
  readonly comment: string | null;
  readonly identity: string;
}

interface ConstraintRow {
  readonly relation: string;
  readonly name: string;
  readonly type: "p" | "u" | "f";
  readonly columns: string[] | null;
  readonly target_schema: string | null;
  readonly target_relation: string | null;
  readonly target_columns: string[] | null;
  readonly on_delete: string;
  readonly on_update: string;
}

interface IndexRow {
  readonly relation: string;
  readonly name: string;
  readonly unique: boolean;
  readonly primary: boolean;
  readonly columns: string[] | null;
}

interface RoutineRow {
  readonly name: string;
  readonly kind: string;
}

function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function groupBy<T extends { readonly relation: string }>(rows: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(row.relation);
    if (group === undefined) groups.set(row.relation, [row]);
    else group.push(row);
  }
  return groups;
}

function referentialAction(letter: string): string {
  return REFERENTIAL_ACTIONS.get(letter) ?? DEFAULT_ACTION;
}

function toColumn(row: ColumnRow, index: number): ColumnMeta {
  return {
    name: row.name,
    position: index + 1,
    type: row.type,
    nullable: row.nullable,
    default: row.default,
    comment: row.comment,
    autoIncrement: row.identity !== IDENTITY_NONE || (row.default?.startsWith(SERIAL_DEFAULT_PREFIX) ?? false),
  };
}

/**
 * Reads `pg_catalog` rather than `information_schema`, which hides objects the user does not own
 * and is several times slower on a wide schema. One query per object family, joined in memory.
 */
export function postgresIntrospector(client: pg.Client): Introspector {
  async function rows<T extends pg.QueryResultRow>(sql: string, values: unknown[] = []): Promise<T[]> {
    try {
      return (await client.query<T>(sql, values)).rows;
    } catch (cause) {
      throw new PluginError("introspectionFailed", messageOf(cause), { cause });
    }
  }

  async function schemaOid(path: readonly string[]): Promise<string> {
    const [database, schema] = path;
    const current = await rows<{ database: string }>("SELECT current_database() AS database");
    if (path.length !== 2 || database !== current[0]?.database || schema === undefined) {
      throw new PluginError("introspectionFailed", `"${path.join(".")}" is not a schema of the connected database.`);
    }
    const found = (await rows<SchemaRow>(SCHEMA_SQL, [schema]))[0];
    if (found === undefined) {
      throw new PluginError("introspectionFailed", `Schema "${schema}" does not exist in database "${database}".`);
    }
    if (!found.usable) {
      throw new PluginError("introspectionFailed", `permission denied for schema ${schema}`);
    }
    return found.oid;
  }

  return {
    async namespaces(): Promise<readonly Namespace[]> {
      const found = await rows<NamespaceRow>(NAMESPACES_SQL);
      const database = found[0]?.database;
      if (database === undefined) return [];
      const schemas = found
        .filter((row) => !TEMPORARY_SCHEMA.test(row.name))
        .map((row): Namespace => ({
          path: [database, row.name],
          name: row.name,
          kind: "schema",
          system: SYSTEM_SCHEMAS.has(row.name),
          current: row.name === row.current,
        }));
      return [{ path: [database], name: database, kind: "database", system: false, current: false }, ...schemas];
    },

    async describe(path: readonly string[]): Promise<NamespaceCatalog> {
      const oid = await schemaOid(path);
      // In turn: one connection runs one query at a time, and pg deprecates queueing them.
      const relations = await rows<RelationRow>(RELATIONS_SQL, [oid]);
      const columns = await rows<ColumnRow>(COLUMNS_SQL, [oid]);
      const constraints = await rows<ConstraintRow>(CONSTRAINTS_SQL, [oid]);
      const indexes = await rows<IndexRow>(INDEXES_SQL, [oid]);
      const routines = await rows<RoutineRow>(ROUTINES_SQL, [oid]);
      const sequences = await rows<{ name: string }>(SEQUENCES_SQL, [oid]);
      const database = path[0] ?? "";
      const columnsOf = groupBy(columns);
      const constraintsOf = groupBy(constraints);
      const indexesOf = groupBy(indexes);
      const described = relations.map((relation): Relation => {
        const keys = constraintsOf.get(relation.name) ?? [];
        const key = (row: ConstraintRow): Key => ({ name: row.name, columns: row.columns ?? [] });
        const primary = keys.find((row) => row.type === "p");
        return {
          name: relation.name,
          kind: RELATION_KINDS.get(relation.kind) ?? "table",
          comment: relation.comment,
          columns: (columnsOf.get(relation.name) ?? []).map(toColumn),
          primaryKey: primary === undefined ? null : key(primary),
          uniqueKeys: byName(keys.filter((row) => row.type === "u").map(key)),
          foreignKeys: byName(
            keys
              .filter((row) => row.type === "f")
              .map((row): ForeignKey => ({
                name: row.name,
                columns: row.columns ?? [],
                target: {
                  path: [database, row.target_schema ?? ""],
                  relation: row.target_relation ?? "",
                  columns: row.target_columns ?? [],
                },
                onDelete: referentialAction(row.on_delete),
                onUpdate: referentialAction(row.on_update),
              })),
          ),
          indexes: byName(
            (indexesOf.get(relation.name) ?? []).map((row): Index => ({
              name: row.name,
              columns: row.columns ?? [],
              unique: row.unique,
              primary: row.primary,
            })),
          ),
        };
      });
      return {
        path: [...path],
        relations: byName(described),
        routines: byName(
          routines.map((row): Routine => ({
            name: row.name,
            kind: row.kind === PROCEDURE_KIND ? "procedure" : "function",
          })),
        ),
        sequences: byName(sequences.map((row): Sequence => ({ name: row.name }))),
      };
    },

    qualifiedName(path: readonly string[], name: string): string {
      // A PostgreSQL statement cannot reach another database, so the database is never part of it.
      return [...path.slice(1), name].map(quote).join(".");
    },
  };
}
