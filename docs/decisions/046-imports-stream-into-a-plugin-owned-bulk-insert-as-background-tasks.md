# 046: Imports stream into a plugin-owned bulk insert as background tasks, and say what was kept

Status: Accepted

## Decision

A CSV or TSV import is a task of the engine beside exports (decision 040), not a second
mechanism. `import.start` answers at once with the task; the engine pushes `import.progress` (at
most every 250 ms) and one final `import.done`, `import.failed` or `import.cancelled` on every
port, each carrying the whole `ImportTask`. `import.cancel`, `import.resume` and `import.list` act
on tasks by id, and the Services tree shows them under Imports.

The engine reads the file itself, as a stream of 64 KiB chunks, through a decoder and an RFC 4180
reader in `core/import/`: the file is never loaded whole and never crosses to the renderer, which
sees only a preview of the first 100 rows. The reader's defaults are the exporter's dialect
(`results/extract/csv.ts`, `tsv.ts`), so an exported file imports back unchanged: an unquoted
field equal to the NULL text is `NULL`, a quoted `""` is the empty string, and the TSV preset has
no quote and backslash escapes.

Writing belongs to the plugin, behind the `bulkInsert` capability (decision 007), which needs
`transactions`. `Session.insertRows(target, rows)` takes rows of text in the exporter's spelling
and writes them all or none: PostgreSQL sends one `COPY … FROM STDIN` per batch (decision 047),
MySQL one multi-row `INSERT` whose values the driver escapes, SQLite a prepared multi-row
`INSERT`, each inside a savepoint so a refused batch leaves the transaction usable. The plugin
turns `0x…` into bytes and `true`/`false` into its boolean. `SqlLanguage.importType` names a
column type for an inferred kind and `createTable` writes the new table's DDL, shown before it
runs. No value is ever spliced into SQL text, and MySQL's `LOAD DATA LOCAL` is not used.

The import runs on a writable session of its own, with TCP keepalive, in manual mode, and the
user picks how much a failure keeps:

- All or nothing (the default): one transaction, committed at the end. A failure, cancel or lost
  link rolls it back and the task says `Nothing was imported`.
- Commit every N rows: the task counts committed rows exactly and offers Resume from the first
  row that was not committed. When the link dies during a COMMIT the task cannot know whether it
  landed, and it says so rather than guessing.

Bad rows either stop the import (the default) or are skipped up to a limit into
`<file>.rejected.csv` with the line and the database's reason; a refused batch is retried row by
row to find them. The rejected file is cut back to the last commit when a task fails, so the
table and the file always agree. A new table is created in a statement of its own before the
first row and stays when the import fails. The stall watchdog and the bounded `close()` are
export's, with the same `data.exportStallSeconds` setting, now labelled Transfer stall timeout.

## Rationale

Users import multi-gigabyte files over the same flaky links they export over. Reading in the
engine keeps the renderer a view (decision 009) and keeps memory flat; reading in main or the
renderer would ship the file across two processes. Each database has a fast path the others lack
(COPY, multi-row INSERT, a prepared statement in one transaction), so one generic INSERT loop in
the engine would be slow on PostgreSQL and the engine would have to know each dialect's binary
and boolean literals, which decision 008 gives to the plugin.

All or nothing is the default because a half-imported table is the worst surprise; Commit every N
exists because a 2 GB import that fails at 90% should not start over. Resuming from a row number
is only safe because the task knows exactly what was committed and the file is read in order;
an import that cannot know (a lost COMMIT) refuses to pretend. `LOAD DATA LOCAL INFILE` was
rejected: it needs `local_infile` on the server, which is often off, and lets the server ask for
any file. Upsert and merge were left out: they need a key the user chooses and change what
"committed rows" means.

## Consequences

- The plugin contract is 0.15.0: the `bulkInsert` capability, `Session.insertRows`,
  `SqlLanguage.importType` and `createTable`. The contract suite round-trips `type_probe` through
  the exporter's text on every built-in.
- The engine's task table is shared by exports and imports; `Engine.tasksSettled()` waits for
  both before an idle engine exits.
- An in-memory SQLite database, and any `privateDatabase`, cannot be imported into: the import's
  own session would see another database.
- The chaos suite (`test/db/import.chaos.test.ts`) proves resets, stalls and cancel through a TCP
  proxy for both transaction modes, and the gated `TABLE_CRAFT_LARGE_IMPORT=1` suite imports a
  2.1 GiB file into PostgreSQL and MySQL with a matching count and checksum at flat memory.
