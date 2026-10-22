# Plan: Open a table, filter it on the server, edit rows and submit

Status: done. F4, double-click or Enter on a table or view, or Search Everywhere's Tables tab,
opens a table tab (`orders [pg]`) on an engine session of its own. `table.query` reads
`SELECT * FROM … WHERE … ORDER BY …` with the bars' text verbatim, pages like a console result and
answers whether the rows are editable: by primary key, else the first all-`NOT NULL` unique key,
otherwise read-only with the reason in a banner (decision 026). A refused clause shows the
database's message under the bars and keeps the rows; header clicks sort on the server through
`table.orderBy`. Pending updates, inserts and deletes live in the renderer's `model/editBuffer.ts`,
coloured by three edit tokens, with inline editing, Set NULL / Set DEFAULT, Add / Duplicate /
Delete Row, Revert and an editable value panel. Preview (⇧⌘P) lists the literal SQL core generates
through the plugin's `language`; Submit (⌘↵) runs it in one transaction where every UPDATE and
DELETE must hit exactly one row, rolls back and names the statement otherwise, and reads the rows
again. ⌘B follows a foreign key, Show Referencing Rows… goes back, Count Rows counts with the
WHERE bar, and closing, reloading, sorting, disconnecting or quitting with pending changes asks
Submit / Discard / Cancel. plugin-api is `0.7.0` (`emptyInsert`, `updateDefault`) and the contract
suite round-trips edits on `edit_probe` on all three databases. Actions now scope to a tab kind,
and the keymap's clash test is region- and tab-aware (decision 027).

## The issue

The explorer shows tables (plan 005) and the console grid reads results (plan 007), but the only
way to change a row is to hand-write `UPDATE` in a console. DataGrip's daily loop is: select a
table in the tree, press F4, narrow it with the WHERE bar, double-click a cell, fix the value,
review, Submit. table-craft has none of that: no table tab, no server-side filter or sort, no edit
buffer, no generated DML.

The driving case is the fixture: open `orders` in PostgreSQL, filter `total > 50`, change one
total, insert a row, delete another, preview, submit, and see the re-queried rows. Then follow
`orders.customer_id` to its customer, and from that customer back to its orders.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Decision 026 governs: rows are identified by the PK or first non-null unique key, otherwise read-only with a reason; literal SQL generated in the engine; one transaction per Submit; each UPDATE/DELETE must hit exactly one row                                                                                                                                                                           |
| 2   | New tab kind `table` in `state/tabs.ts` (`{datasourceId, path, relation}`), label `orders [pg]`, table icon, tinted like consoles. Opening a table that is already open activates its tab                                                                                                                                                                                                                   |
| 3   | Each table tab opens its own engine session (`session.open`), separate from consoles, closed with the tab. Restored on relaunch like consoles, disconnected until first use (ADR 021)                                                                                                                                                                                                                       |
| 4   | New request `table.query {sessionId, path, relation, where, orderBy}` → `TableQuery {statement: ExecutedStatement, sql, editable: {identity: string[]} \| {readOnly: string}, columns: ColumnMeta[]}`. The engine builds `SELECT * FROM <qualifiedName> [WHERE …] [ORDER BY …]` and takes column metadata and keys from the catalog cache (describing the namespace if needed). Paging follows decision 025 |
| 5   | WHERE and ORDER BY bars above the grid: single-line CodeMirror fields with the dialect's highlighting, text inserted verbatim, Enter applies, Esc reverts the field. An error from the database shows inline under the bar and keeps the previous rows                                                                                                                                                      |
| 6   | In the editor, a header click cycles that column's server sort and rewrites the ORDER BY bar (⌥-click appends a key); local `result.sort` is not offered for table tabs                                                                                                                                                                                                                                     |
| 7   | Context menu "Filter by This Value" sets the WHERE bar to `<col> = <literal>` (or `IS NULL`); several selected cells in one column give `IN (…)`                                                                                                                                                                                                                                                            |
| 8   | Pending changes live in the renderer, `model/editBuffer.ts`: `updates: Map<row, Map<column, CellInput>>`, `inserts: {id, values: CellInput[]}[]`, `deletes: Set<row>`. `CellInput = {kind:"text", text} \| {kind:"null"} \| {kind:"default"}`. A row is the index in the result store; inserted rows render after loaded rows until submit                                                                  |
| 9   | Cell editing: Enter, F2, double-click or typing starts an inline editor; Enter commits to the buffer, Esc cancels, Tab moves right. `table.setNull` (⌥⌘N) and `table.setDefault` (⌥⌘D) write the special inputs. Bytes and identity-less columns refuse with a tooltip                                                                                                                                      |
| 10  | The value panel (⇧↵) becomes editable for text and JSON cells in an editable table; ⌘↵ in the panel writes the buffer. ⌘C/⌘A in the panel stay on its text                                                                                                                                                                                                                                                  |
| 11  | Change highlighting through tokens: edited cell `--tc-edit-modified`, inserted row `--tc-edit-inserted`, deleted row `--tc-edit-deleted` with strike-through. The footer shows `3 pending changes`                                                                                                                                                                                                          |
| 12  | `table.addRow` (⌘N in the editor) appends an insert with every column `default`; `table.duplicateRow` (⌘D) copies the selected rows, putting `default` in identity and auto-increment columns; `table.deleteRows` (⌘⌫) marks rows, and deleting an unsubmitted insert drops it                                                                                                                              |
| 13  | `table.revertSelected` (⌥⌘Z) and `table.revertAll` undo buffer entries; ⌘Z inside an inline cell editor stays CodeMirror's/the input's                                                                                                                                                                                                                                                                      |
| 14  | `edits.preview {handle, edits}` → `{statements: string[]}` and `edits.submit {sessionId, handle, edits}` → `{statements, rowsAffected}` or an `editRejected` error carrying the failing statement index and message. Order: deletes, updates, inserts. Inserts list only non-`default` columns; when none remain the plugin's new `language.emptyInsert(table)` is used                                     |
| 15  | `table.submit` (⌘↵ in the editor region) runs submit and re-queries with the same bars; `table.preview` (⇧⌘P) opens a modal listing the SQL with Submit and Cancel. A read-only datasource never gets this far: the editor is read-only (decision 011)                                                                                                                                                      |
| 16  | Re-query, filter change, Rerun (⌘R), tab close, disconnect and window close with pending changes ask Submit / Discard / Cancel; window close goes through decision 024's renderer answer                                                                                                                                                                                                                    |
| 17  | FK navigation: on a cell in an FK column, `table.goToReferenced` (⌘B) opens the target table filtered to `<target cols> = <literals>`. `table.showReferencing` lists the catalog's foreign keys that point at this table (any described namespace of the datasource) and opens the chosen one filtered to the selected row's key                                                                            |
| 18  | `explorer.openData` (F4, and double-click / Enter on a table or view node) opens the editor; Search Everywhere's Tables tab gains "Open Data" as the default for tables                                                                                                                                                                                                                                     |
| 19  | `table.countRows` runs `SELECT COUNT(*)` with the WHERE bar and shows `12,345 rows` in the footer until the next query                                                                                                                                                                                                                                                                                      |
| 20  | Editing console results, transposed/record view, bulk paste of many cells, editing bytes, server-side paging by OFFSET: out (see Out of scope)                                                                                                                                                                                                                                                              |
| 21  | `API_VERSION` 0.7.0 for `emptyInsert`; the contract suite gains an edits round trip per plugin (update by PK, insert with defaults, empty insert, delete, rollback on a zero-row update) against a dedicated `edit_probe` fixture table                                                                                                                                                                     |

### Consequences worth naming

**This changes the plugin contract.** `SqlLanguage.emptyInsert(qualifiedTable: string): string`,
`API_VERSION` 0.7.0. Every built-in implements it; the contract suite checks it runs.

**This crosses the fence.** New requests `table.query`, `edits.preview`, `edits.submit`, error code
`editRejected`.

**This default was chosen without asking.** Submit commits; there is no manual transaction mode in
the data editor (DataGrip has one). A table tab's Tx is always Auto, and its toolbar says so.

**This is a behaviour change.** Double-click and Enter on a table node in the tree now open data
instead of only expanding; the chevron and → still expand.

---

## Phase 0 — plugin-api, core and plugins

| File                                      | Responsibility                                                                                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/plugin-api/src/plugin.ts`       | `emptyInsert` on `SqlLanguage`; `API_VERSION` 0.7.0                                                                                                        |
| `packages/plugin-api/src/sql/literals.ts` | `defaultValuesInsert(table)` helper (`INSERT INTO t DEFAULT VALUES`)                                                                                       |
| `plugins/{postgres,sqlite}`               | `emptyInsert` via the helper                                                                                                                               |
| `plugins/mysql`                           | `INSERT INTO t () VALUES ()`                                                                                                                               |
| `packages/core/src/edits/generate.ts`     | `generateEdits({table, columns, identity, rows, edits, language}) → string[]`; refuses an update or delete whose identity value is NULL or a bytes preview |
| `packages/core/src/edits/identity.ts`     | `editableIdentity(relation, readOnly, capabilities) → {identity} \| {readOnly: reason}`                                                                    |
| `packages/core/src/edits/submit.ts`       | runs statements in one transaction via `Session.transactions`, checks counts, rolls back on any failure, returns `rowsAffected`                            |
| `packages/plugin-api/src/testing`         | edits round trip on `edit_probe`                                                                                                                           |
| `test/db/schema/*.sql`                    | `edit_probe (id PK auto-increment, label text NOT NULL, qty int DEFAULT 1, note text NULL)` and `no_key_probe (label text)` in all three dialects          |

```ts
export type CellInput = { kind: "text"; text: string } | { kind: "null" } | { kind: "default" };
export type RowEdit =
  | { kind: "update"; row: number; values: readonly { column: number; value: CellInput }[] }
  | { kind: "insert"; values: readonly CellInput[] }
  | { kind: "delete"; row: number };
```

A `text` input becomes `language.literal(text, columnType)`; the database casts.

## Phase 1 — engine and protocol

- `engine/protocol.ts`: `table.query`, `edits.preview`, `edits.submit`, `TableQuery`, `RowEdit`,
  `CellInput`, `editRejected`.
- `engine/engine.ts`: builds the table SELECT from bars, resolves identity from the catalog cache,
  remembers per handle that it is a table result (local sort refused with `invalidRequest`),
  resolves `row` to stored values, closes the open cursor before submit (decision 025).
- `engine/requests.ts`: zod for the new requests.

## Phase 2 — renderer

| File                        | Responsibility                                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `state/tabs.ts`             | `TabKind = "console" \| "table"`                                                                                                 |
| `state/tables.ts`           | per table tab: session, bars, current query, `TableQuery`, edit buffer, status                                                   |
| `model/editBuffer.ts`       | pure buffer operations: set, setNull, setDefault, addRow, duplicate, delete, revert, `toEdits()`, `pendingCount`                 |
| `table/TableEditor.tsx`     | toolbar (Reload, Add, Duplicate, Delete, Revert, Preview, Submit, Count, `Tx: Auto` label), bars, grid, footer, read-only banner |
| `table/FilterBar.tsx`       | the WHERE / ORDER BY CodeMirror fields                                                                                           |
| `table/PreviewDialog.tsx`   | SQL list, Submit, Cancel                                                                                                         |
| `grid/ResultGrid.tsx`       | optional edit layer: cell editor, highlight classes, inserted rows after loaded rows, server-sort header mode                    |
| `grid/ValuePanel.tsx`       | editable mode                                                                                                                    |
| `actions/tableActions.ts`   | the `table.*` actions in a `tableEditor` focus region, plus `explorer.openData`                                                  |
| `palette/tablesProvider.ts` | Open Data as the default for tables                                                                                              |

## Phase 3 — Fixtures, tests, docs

Fixture schema: `edit_probe` and `no_key_probe` in all three seeds; nothing existing changes, so
older assertions stay.

New cases:

`givenTableWithPrimaryKey_whenIdentityResolved_thenPrimaryKeyColumns`,
`givenTableWithOnlyNullableUnique_whenIdentityResolved_thenReadOnlyWithReason`,
`givenView_whenIdentityResolved_thenReadOnly`,
`givenReadOnlyDatasource_whenIdentityResolved_thenReadOnly`,
`givenUpdateOfTwoCells_whenGenerated_thenOneUpdateKeyedByPrimaryKey`,
`givenInsertWithDefaults_whenGenerated_thenDefaultColumnsOmitted`,
`givenInsertWithAllDefaults_whenGenerated_thenEmptyInsertFromPlugin`,
`givenNullInput_whenGenerated_thenNullLiteral`,
`givenDeletesUpdatesInserts_whenGenerated_thenDeletesFirstInsertsLast`,
`givenUpdateAffectingZeroRows_whenSubmitted_thenRolledBackAndEditRejected`,
`givenFailingSecondStatement_whenSubmitted_thenFirstRolledBack`,
`givenEditBuffer_whenInsertDeleted_thenInsertDropped`,
`givenEditBuffer_whenRevertSelected_thenOnlyThoseCellsReverted`,
`givenDuplicateRow_whenBuffered_thenIdentityColumnsDefault`,
`givenTableResult_whenLocalSortRequested_thenInvalidRequest`,
`givenWhereAndOrderBars_whenQueryBuilt_thenVerbatimClauses`,
`givenFkCell_whenGoToReferenced_thenTargetFilterOnTargetColumns`,
`givenTableActions_whenKeymapBuilt_thenNoChordClash`.

Contract (`test:db` and SQLite): `givenEditProbe_whenEditsRoundTrip_thenRowsMatch` per plugin.

Docs: spec gains "Table data editor" (requests, identity rule, submit order); design-system gains
the edit tokens; AGENTS layout gains `core/src/edits/` and `renderer/table/`.

Every phase ends with `bun run typecheck` and `bun run test` green; phases 0 and 1 also run
`bun run test:db`.

---

## Live test

Run with `TABLE_CRAFT_EVIDENCE_DIR=docs/evidence/008 bun run test:smoke:db`, suite
`test/e2e/tableEditor.smoke.test.ts`, 1200×800.

| #   | Scenario                                                                                   | Database | Result                                                                                                                                                                         | Evidence                 |
| --- | ------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| 1   | F4 on `orders` opens `orders [pg]` with rows and `Tx: Auto`                                | postgres | Pass. Tab `orders [pg]`, ids 1, 2, 3, `Tx: Auto` in the toolbar, no read-only banner                                                                                           | open-table.png           |
| 2   | WHERE `total > 50` + ORDER BY `placed_at desc` filter on the server                        | postgres | Pass, with `total > 10` (only one row passes `> 50`, so the order would not show): ids 3, 1                                                                                    | where-order.png          |
| 3   | Bad WHERE shows the error under the bar, rows kept                                         | mysql    | Pass. `no_such_column > 1`: MySQL's `Unknown column` under the bars, WHERE bar red, ORDER BY not, rows kept                                                                    | where-error.png          |
| 4   | Edit a total, insert a row, delete a row: three highlights, `3 pending changes`            | postgres | Pass. Modified total, deleted row struck through, inserted row 4; footer `3 pending changes`                                                                                   | pending-changes.png      |
| 5   | Preview lists DELETE, UPDATE, INSERT with literals; Submit re-queries and highlights clear | postgres | Pass. `DELETE … WHERE "id" = 2`, `UPDATE … SET "total" = '25.00' WHERE "id" = 1`, `INSERT …`; Submit → `Submitted 3 statements`, ids 1, 3, 4, no highlights                    | preview-submit.png       |
| 6   | Set NULL and Set Default on `edit_probe`; empty insert works                               | mysql    | Pass. qty `<null>`, label `<default>`, plus an all-default Add Row (empty insert); after Submit labels `first`, `new`, `new`, qty `<null>`, 2, 1                               | null-default.png         |
| 7   | Concurrent delete from a console → Submit rolls back and names the statement               | postgres | Pass. Console deletes row 3 → Submit answers `Statement 2 affected 0 rows…`, rolled back, `2 pending changes` kept; Rerun → Discard restores                                   | rejected-rollback.png    |
| 8   | Duplicate row gets default id; submit creates it                                           | sqlite   | Pass. ⌘D copies row 1 with id `<default>`; Submit creates id 3                                                                                                                 | duplicate-row.png        |
| 9   | `no_key_probe` and a view open read-only with the reason                                   | postgres | Pass. `customer_totals`: `Read-only: Views are read-only.`; `no_key_probe`: `No primary key or non-null unique key identifies a row.`, Enter opens no editor, Add Row disabled | read-only-table.png      |
| 10  | Read-only datasource: editor read-only                                                     | sqlite   | Pass. Saved read-only SQLite: `Read-only: The datasource is read-only.`, double-click opens no editor                                                                          | read-only-datasource.png |
| 11  | ⌘B on `orders.customer_id` opens `customers` filtered to that id                           | postgres | Pass. ⌘B on order 3's `customer_id` → `customers [pg]`, WHERE `"id" = 2`, Grace Hopper                                                                                         | fk-go-to.png             |
| 12  | Show Referencing Rows from a customer opens its orders                                     | mysql    | Pass. Customer 1 → menu Show Referencing Rows… → `orders (customer_id)` → `orders [mysql]`, WHERE `` `customer_id` = 1 ``, ids 1, 2                                            | fk-referencing.png       |
| 13  | Close tab with pending changes asks Submit / Discard / Cancel                              | postgres | Pass. ⌘W asks Pending changes with Submit / Discard / Cancel; Cancel keeps the tab, Discard closes it                                                                          | close-pending.png        |
| 14  | Edit JSON in the value panel and submit                                                    | postgres | Pass. `doc` edited in the value panel, ⌘↵ → `1 pending change`; Submit → `{"kept": true, "tags": ["a", "b"]}`                                                                  | value-panel-edit.png     |

Bugs found while testing get a regression test and a row in Deviations.

---

## Deviations taken while implementing

**1. `language.updateDefault(defaultExpression)` joins `emptyInsert`.** SQLite has no
`SET col = DEFAULT`, so Set DEFAULT on an existing row cannot be one keyword everywhere. PostgreSQL
and MySQL answer `DEFAULT`; SQLite answers the column's declared default expression, or `NULL`.

**2. `edit_probe.label` has `DEFAULT 'new'`, and `edit_probe` has a `doc` JSON column.** A
`NOT NULL` column without a default makes the empty insert fail on every database, and live test 14
needs a JSON cell in a table with a key. `no_key_probe` is as planned.

**3. Two older smoke assertions changed.** The fixture gained two tables, so the explorer and
console suites' `tables 3` / `tables 4` labels read `tables 5` / `tables 6`. Search Everywhere's
Tables scenario now expects the table's data to open on Enter instead of the tree reveal.

**4. `table.count` reads on a session of its own.** Running `COUNT(*)` on the editor's session would
close its open cursor (decision 025) and with it Fetch Next Page. A short-lived session leaves the
grid alone.

**5. `table.condition` and `table.orderBy` join the protocol.** Filter by This Value, ⌘B, Show
Referencing Rows… and header sorting need literals and quoted identifiers, which belong to the
plugin (decision 008). The engine writes the condition from the held rows' values (by result
column, written against the target column's name) and the ORDER BY from `{name, direction}` terms.

**6. `TableQuery` carries `foreignKeys` and `referencing`.** The renderer cannot ask the catalog for
"foreign keys pointing at this table", so the engine answers them with the query from every
described namespace (`CatalogCache.described()`).

**7. A stale catalog makes the editor read-only.** When the result's columns do not match the cached
relation (altered since the last describe), identity cannot be trusted; the banner says to
Synchronize and Reload.

**8. Region- and tab-kind-aware keymap: decision 027.** DataGrip's ⌘↵, ⌘N and ⌘D mean different
things in a console, a table editor and the tree. Actions gain `tabKind`; the focus regions gain
`tableEditor` and `valuePanel`; `findClashes` reports only overlapping bindings; text fields keep
their own ⌘Z/⌘A/⌘C/⌘X/⌘V/⌘⌫.

**9. The grid and its windows are shared, not copied.** `ResultGrid` takes a `GridHost`
(`ensureWindow`, `select`, `setLayout`) and an optional edit layer; the window/fetch/extract logic
moved from `state/consoles.ts` into `state/resultWindows.ts` and `state/resultTab.ts`, used by both
the consoles and the new tables store. Grid actions dispatch to whichever owns the active tab.

**10. The preview is a modal kind, not a dialog component of its own.** `state/modal.ts` gains a
`statements` request; `table/PreviewDialog.tsx` renders its numbered list inside the shared modal,
so focus, Esc and the answer flow stay the modal's.

**11. Refused edits are silent; the banner explains.** Plan decision 9 asked for a tooltip when a
bytes cell or a read-only table refuses an edit. The read-only banner already states the reason
and Edit Cell is disabled there; a bytes cell simply opens no editor, as its value panel shows only
a hex preview.

**12. A lost connection discards pending changes.** When the engine exits or the datasource
disconnects underneath the editor, there is no session to submit on; the buffer is dropped with the
notice `The connection closed; N pending changes were discarded.` A user-initiated disconnect asks
first.

**13. Live test 2 filters `total > 10`.** Only one fixture order passes `total > 50`, so the ORDER BY
would show nothing; `> 10` keeps two rows in `placed_at desc` order. Editing scenarios pin
`ORDER BY id`, since PostgreSQL returns an updated row last without one.

**14. Bugs found while testing.** (a) A new table session started as `connecting`, which the read
path refuses, so the first query never ran; it starts `disconnected` (`tablesStore.test.ts` opens
and reads). (b) A refused query turned both bars red even when ORDER BY was empty; `refusedBars`
marks only non-blank bars (store test and the `where-error` scenario assert it). (c) Submit used
the Export icon; it is `CheckCircle`. (d) An edit colour could paint over the selection, depending
on CSS order; the selection now replaces the edit background, and a deleted row keeps its
strike-through.

---

## Out of scope

- Editing console results: needs source-table resolution per column; a later decision.
- Manual transaction mode in the data editor: Submit commits (decision 026).
- Editing bytes and values beyond the wire preview: needs a full-value request.
- Transposed and single-record views, aggregate view, bulk paste across many cells.
- Create/Modify Table (schema editing): with the DDL view in plan 010 or later.
- Server-side paging by OFFSET: the cursor pages (decision 025).
