# 052: Object DDL is a plugin capability over a typed change

Status: Proposed. Plugin API 0.17.0.

## Decision

Creating, modifying, renaming, truncating and dropping objects from the database tree is the
optional `objects` capability (it requires `sql` and `schemaTree`; `ddl` stays the capability that
reads definitions, decision 029). A plugin that declares it puts an `ObjectEditor` on
`SqlLanguage.objects`:

- `features`: the type suggestions, whether checks, comments and cascade exist, whether truncate
  exists, the namespace kind it can create (`schema`, `database` or none), and which object kinds
  it renames and drops. The renderer branches on these, never on a plugin id (decision 007).
- `design(relation)`: a `TableDesign` (columns, primary key, indexes, foreign keys, checks, each
  remembering its `original` name) built from the described relation.
- `script(change, context)`: a `DdlScript` for an `ObjectChange` (`createTable`, `alterTable`,
  `rename`, `drop`, `truncate`, `createNamespace`). The script is `prepare`, `statements`,
  `verify` (queries that must return no rows), `finish`, `transactional` and `notes` for the
  preview. A modify diffs the design against the table's current design, matched by `original`,
  and emits only what changed; an unchanged design is no statements.

The engine owns running it. `objects.script` previews; `objects.apply` takes the change and the
statements the user saw, scripts the change again against a freshly described table, refuses when
the statements differ ("changed since the preview"), and runs it on a dedicated session: `prepare`,
then the statements and `verify` in one transaction where `transactional`, then `commit`, rolling
back on any failure, then `finish`. It then refreshes the catalog cache for the namespace. Read-only
datasources, private in-memory databases and a table an import or export is using (`objectBusy`)
are refused before anything runs. The log records the change kind, object kind and name only.

## Rationale

SQL belongs to the plugin (decision 008): quoting, identity columns, `CHANGE COLUMN`, SQLite's
rebuild and cascade rules differ per dialect. A typed change rather than SQL text keeps the
renderer out of SQL, lets the engine re-derive what it runs instead of trusting text from the
renderer, and lets one contract suite check every dialect the same way. Previewing and applying
the same script, checked by equality, means the user approves exactly what runs.

## Consequences

- PostgreSQL and SQLite apply in one transaction; a failure changes nothing. MySQL commits each
  DDL statement, so its modify is one `ALTER TABLE` with comma clauses and every preview says so.
- Check constraints are not in the catalog yet, so a design starts with none; checks added in the
  designer are created, existing ones are left alone (PostgreSQL, MySQL) or lost by a SQLite
  rebuild, which its note states.
- Routines and sequences can be renamed and dropped; editing their bodies, partitioning, grants
  and tablespaces are out of scope.
