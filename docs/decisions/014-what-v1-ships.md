# 014: What v1 ships

Status: Accepted

## Decision

**v1**

- Built-in plugins: PostgreSQL (`pg`), MySQL / MariaDB (`mysql2`), SQLite (`node:sqlite`)
- Connections: plugin-generated form, test connection, folders, `safeStorage` secrets, read-only
  and colour flags
- Database explorer: lazy tree, manual refresh
- SQL console: run statement or selection, cancel, autocomplete, auto/manual commit
- Result grid: engine-side result sets, virtualized, copy, CSV / JSON export
- Table data editor: edit, insert, delete, preview generated SQL, submit
- DDL view
- Query history per datasource
- EXPLAIN plan view
- Appearance: themes, user themes, three font settings, density
- Packaging: macOS (arm64, x64) first-class; Windows (NSIS) and Linux (AppImage) built in CI,
  best-effort

**v1.1**: SSH tunnels, saved query files.

**Later**: ER diagrams, schema compare and migrations, data import, a plugin marketplace,
Redis / MongoDB plugins, a CLI.

## Rationale

v1 is the loop a DataGrip user runs all day: connect, look, query, read, fix a row. Everything in
it exercises the plugin contract, which is the part that must be right before third parties build
on it.

## Consequences

- Features outside this list need this record updated, not just a plan.
