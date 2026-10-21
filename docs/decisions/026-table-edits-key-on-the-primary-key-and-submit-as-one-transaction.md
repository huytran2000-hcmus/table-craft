# 026: Table edits key on the primary key and submit as one transaction

Status: Accepted

## Decision

- A table opened in the data editor is editable when the engine can identify its rows: by the
  primary key, else by the first unique key whose columns are all `NOT NULL`. Otherwise it opens
  read-only with the reason in a banner ("no primary key or non-null unique key"). Views,
  materialized views, read-only datasources and plugins without the `transactions` capability are
  read-only too. There is no fallback to `ctid`, `rowid` or "match every column".
- The renderer holds pending changes (updates, inserts, deletes) keyed by the row's index in the
  result store. The engine turns them into literal SQL with the plugin's `quoteIdentifier`,
  `literal` and `qualifiedName`; the Preview shows exactly the statements Submit runs.
- Submit runs every statement in one transaction on the editor's own session and commits. Each
  `UPDATE` and `DELETE` must affect exactly one row; any other count, or any error, rolls the whole
  batch back and names the statement. The table is then queried again with the same filter and
  order.
- The data editor sorts and filters on the server: header clicks and the ORDER BY bar write
  `ORDER BY`, the WHERE bar writes `WHERE`. Local sort (decision 025) stays for console results and
  is disabled in the editor, so a store index always names the row the database returned.

## Rationale

Editing without a reliable key is how a GUI updates the wrong row. `ctid` and `rowid` change under
`VACUUM FULL` or `REPLACE`, and matching every column breaks on floats, large text and duplicates.
DataGrip offers those fallbacks; refusing them costs a few edge tables and removes a class of
silent data damage. Literal SQL rather than bound parameters keeps the preview honest: what the
user reads is what runs. The exactly-one-row check is a cheap optimistic-concurrency guard against
a row deleted or re-keyed by someone else.

## Consequences

- Plugin `language` gains `emptyInsert(qualifiedTable)` for an insert where every column takes its
  default (`DEFAULT VALUES` against MySQL's `() VALUES ()`); `API_VERSION` 0.7.0.
- Bytes cells are read-only in v1: the wire carries a preview only (decision 017).
- Console results stay read-only; editing a console result is a later decision.
- After Submit the grid re-queries, so open cursors close and paging restarts at the first page.
