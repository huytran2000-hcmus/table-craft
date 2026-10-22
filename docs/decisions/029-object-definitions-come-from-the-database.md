# 029: Object definitions come from the database, not from the cached catalog

Status: Accepted

## Decision

The DDL a user sees for a table, view or materialized view is read from the database each time it
is asked for, by the plugin, through a new optional `Introspector.definition(path, name)` present
iff the plugin declares the `ddl` capability.

- MySQL answers with `SHOW CREATE TABLE` / `SHOW CREATE VIEW`, verbatim.
- SQLite answers with `sqlite_master.sql` for the relation, then the `sql` of its explicit indexes
  and triggers, verbatim.
- PostgreSQL has no single statement for this, so the plugin assembles it from the server's own
  printers: `format_type` and `pg_get_expr` for columns, `pg_get_constraintdef` for every
  constraint (primary, unique, foreign, check, exclusion), `pg_get_indexdef` for indexes not
  backing a constraint, `pg_get_viewdef` for views, and `COMMENT ON` for comments.

The generated statements that are not definitions — DROP, SELECT, INSERT and UPDATE — are built by
the plugin's `language` from the cached catalog (decision 022), through a shared
`sqlGenerator` in `@table-craft/plugin-api/sql`, like `sqlCompleter` (decision 028).

## Rationale

The cached catalog (decision 022) already holds columns, keys, foreign keys and indexes, so
generating CREATE TABLE from it would cost no query. It would also be wrong in ways a user cannot
see: the catalog has no check constraints, no view bodies, no triggers, no partitioning, storage
options or collations, and a definition that silently omits a `CHECK` is worse than none. Widening
the catalog to carry all of that would make every `describe` slower for the sake of one tab, and
each dialect would still need its own printer. The database already prints its own objects; decision
017 says values cross as the database prints them, and a definition is such a value.

DROP, SELECT, INSERT and UPDATE only need names, columns, keys and defaults, which the catalog has
exactly, and need to be quoted and qualified by the dialect, which is the language's job (decision
008).

## Consequences

- Opening a definition costs one round trip on the introspection session; it is never stale by
  more than the time since it was opened, and the DDL tab refetches when its namespace is
  re-described.
- A third-party plugin with `schemaTree` but no `ddl` still works: the UI hides Go to DDL and the
  generator's CREATE, and ⌘B on a relation falls back to revealing it (decision 007).
- MySQL's text carries `DEFINER`, `AUTO_INCREMENT=` and charset clauses as the server prints them.
  We show them; we do not edit them out.
- Routine and sequence definitions are not covered yet; the same method takes them when the tree
  can open them.
