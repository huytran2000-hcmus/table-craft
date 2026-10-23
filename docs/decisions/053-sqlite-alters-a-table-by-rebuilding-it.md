# 053: SQLite alters a table by rebuilding it

Status: Proposed.

## Decision

The SQLite plugin applies a modify in place when SQLite can: rename the table or a column, add a
column with a constant default, drop a column no key or index uses, add or drop an index. Anything
else (a type, nullability, default or key change) is the documented rebuild: create
`<table>__table_craft_new` with the new design, `INSERT … SELECT` the kept columns, drop the old
table, rename the new one, and recreate the indexes, all in one transaction. `prepare` turns
`PRAGMA foreign_keys` off on the dedicated session, `verify` runs `PRAGMA foreign_key_check` on the
table and rolls back when it reports a row, and `finish` turns foreign keys back on.

## Rationale

SQLite's `ALTER TABLE` cannot change a column's definition. The rebuild is the procedure SQLite
documents (https://www.sqlite.org/lang_altertable.html, "Making Other Kinds Of Table Schema
Changes"). `foreign_keys` cannot change inside a transaction, so it sits outside it; the check
inside keeps a rebuild from committing orphaned references.

## Consequences

- A rebuild drops triggers and check constraints the designer did not show; the preview notes it.
- Rows, indexes and the foreign keys pointing at the table survive; a failed rebuild leaves the
  table as it was.
