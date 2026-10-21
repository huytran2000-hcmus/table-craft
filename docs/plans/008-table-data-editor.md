# Plan: Open a table, filter it on the server, edit rows and submit

Status: not started

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

| #   | Scenario                                                                                   | Database | Result | Evidence                 |
| --- | ------------------------------------------------------------------------------------------ | -------- | ------ | ------------------------ |
| 1   | F4 on `orders` opens `orders [pg]` with rows and `Tx: Auto`                                | postgres |        | open-table.png           |
| 2   | WHERE `total > 50` + ORDER BY `placed_at desc` filter on the server                        | postgres |        | where-order.png          |
| 3   | Bad WHERE shows the error under the bar, rows kept                                         | mysql    |        | where-error.png          |
| 4   | Edit a total, insert a row, delete a row: three highlights, `3 pending changes`            | postgres |        | pending-changes.png      |
| 5   | Preview lists DELETE, UPDATE, INSERT with literals; Submit re-queries and highlights clear | postgres |        | preview-submit.png       |
| 6   | Set NULL and Set Default on `edit_probe`; empty insert works                               | mysql    |        | null-default.png         |
| 7   | Concurrent delete from a console → Submit rolls back and names the statement               | postgres |        | rejected-rollback.png    |
| 8   | Duplicate row gets default id; submit creates it                                           | sqlite   |        | duplicate-row.png        |
| 9   | `no_key_probe` and a view open read-only with the reason                                   | postgres |        | read-only-table.png      |
| 10  | Read-only datasource: editor read-only                                                     | sqlite   |        | read-only-datasource.png |
| 11  | ⌘B on `orders.customer_id` opens `customers` filtered to that id                           | postgres |        | fk-go-to.png             |
| 12  | Show Referencing Rows from a customer opens its orders                                     | mysql    |        | fk-referencing.png       |
| 13  | Close tab with pending changes asks Submit / Discard / Cancel                              | postgres |        | close-pending.png        |
| 14  | Edit JSON in the value panel and submit                                                    | postgres |        | value-panel-edit.png     |

Bugs found while testing get a regression test and a row in Deviations.

---

## Deviations taken while implementing

---

## Out of scope

- Editing console results: needs source-table resolution per column; a later decision.
- Manual transaction mode in the data editor: Submit commits (decision 026).
- Editing bytes and values beyond the wire preview: needs a full-value request.
- Transposed and single-record views, aggregate view, bulk paste across many cells.
- Create/Modify Table (schema editing): with the DDL view in plan 010 or later.
- Server-side paging by OFFSET: the cursor pages (decision 025).
