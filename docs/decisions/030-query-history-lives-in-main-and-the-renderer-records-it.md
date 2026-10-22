# 030: Query history lives in main, and the renderer records it

Status: Accepted

## Decision

Query history is one SQLite file, `<userData>/history.sqlite` (decision 010), opened by main
through `node:sqlite`. The store's logic (schema, recording, pruning, search) lives in
`@table-craft/core` under `history/` (decision 004); main only opens it at the profile path and
answers three invoke channels: record, search and clear.

The renderer records. After each statement a console runs, and after each table-editor submit, it
sends one entry to main without awaiting it: the statement text as run, when it started, how long
it took as the console measures it, the outcome, the row count and, for a failure, the message.
Nothing on the run path waits for history, and a failed write never fails a run.

The Services window's executions are a separate, in-memory record per open tab, kept by the
renderer for the life of the tab. They are not history and are not saved.

## Rationale

Three places could record. The engine sees every statement, but it is one process per datasource
that exits on disconnect and on a crash (decision 021), several engines writing one file would
contend for its lock, and it cannot tell a statement the user wrote from one the table editor
generated to page rows. The renderer knows all of that but may not touch files (decision 002's
fence). Main may, already writes the profile's other files on the renderer's request
(`datasources.json`, console files), and outlives every engine, so history survives the crash of
the engine that ran the statement.

Recording after the statement keeps main out of the request path: the renderer talks to the engine
directly and tells main afterwards. SQLite rather than a JSON file because history only grows, is
searched by substring and is pruned from the oldest end; appending a row is cheap where rewriting a
growing JSON file is not, and `node:sqlite` already ships in Electron's Node (the SQLite plugin uses
it).

## Consequences

- A statement is recorded only if the renderer lives to see it finish; one running when the window
  dies is lost.
- The duration in history is the one the Output tab shows: the console's round trip, including
  IPC, not the server's own execution time.
- `node:sqlite` is synchronous, so a record blocks main for one insert; history writes are a few
  hundred bytes and main does no other database work.
- Statement text is stored verbatim and unencrypted, including any password in an `ALTER USER`.
  Clearing a datasource's history, or deleting the datasource, removes it.
- Consoles on the `TABLE_CRAFT_DATASOURCE` datasource record nothing, as their text is not saved
  (decision 018).
