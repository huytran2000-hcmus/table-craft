# 022: The schema is the unit of introspection

Status: Accepted

## Decision

A plugin with the `schemaTree` capability exposes an `Introspector` on its session with two calls:

- `namespaces()` lists the databases and schemas the user can see, cheaply, with no objects.
- `describe(namespace)` returns that namespace's whole catalog in one call: tables, views and
  materialized views with their columns, primary key, unique keys, foreign keys and indexes, plus
  routine and sequence names.

The engine caches each described namespace in memory, keyed by namespace path, with the time and
duration of its introspection. Expanding a namespace describes it once; Refresh (`Synchronize`)
describes it again. The cache dies with the engine. The renderer receives a copy of each described
catalog for the tree and search; it holds metadata, never rows.

Namespaces the plugin marks `system` (`pg_catalog`, `information_schema`, `mysql`, `sys`,
`performance_schema`) are hidden unless the user turns on "Show system schemas".

## Rationale

Two alternatives were live. Querying per tree node (columns when a table expands) is the simplest
to write, but costs a round trip per click, and plans 008 to 010 need the whole schema anyway:
foreign-key navigation, completion across tables, and DDL all ask about objects nobody expanded.
Introspecting the whole server on connect is what completion would like, but a production server
with hundreds of schemas makes connect slow and holds memory nobody asked for. A schema is the
unit people work in, the unit DataGrip's own "schemas to introspect" setting chooses, and one
`information_schema` or `pg_catalog` pass per schema is a handful of queries regardless of size.

The renderer holding a copy does not break decision 009: that decision keeps unbounded rows out of
the renderer. A catalog is bounded by the schema, and a 1,000-table schema is a few hundred
kilobytes.

## Consequences

- Introspection runs on a dedicated engine session, never a console's, so it neither waits behind
  a long query nor joins a console's transaction (decision 002).
- The model in plugin-api is normalized: names, kinds, nullability, defaults, comments and key
  structure are common; each column's type stays the database's own text (decision 017).
- A stale cache is expected after DDL. Plan 006 may refresh a namespace after a DDL statement; until
  then the user synchronizes.
- Very large schemas (10,000+ tables) arrive in one message. If that ever hurts, describe gains
  paging; the call shape does not change.
