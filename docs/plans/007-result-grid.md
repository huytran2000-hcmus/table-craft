# Plan: Make the result grid a DataGrip grid

Status: not started

## The issue

A console result today is a read-only virtualized table (`renderer/grid/ResultGrid.tsx:19`): no row
numbers, no selection, no copy, no sort, fixed column widths, `<null>` in body text, and a footer
saying `N rows`. The engine drains every statement to 10,000 rows before answering
(`core/src/results/store.ts:43`), so `SELECT * FROM big_table` costs 10,000 rows of database and
wire time even when the user reads ten. Rows the renderer has loaded are never evicted
(`state/consoles.ts:476`), and when the engine exits the grid keeps scroll placeholders that will
never fill (plan 004 risk).

The driving case: `SELECT * FROM generate_series(1, 50000) g, LATERAL (SELECT md5(g::text)) m` on
the test Postgres. The user scrolls, fetches more, sorts by a column, selects a block, copies it as
CSV into a spreadsheet and as `INSERT` statements into another console, opens one long value, then
exports everything to a file.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Lazy fetching per decision 025: `RESULT_PAGE_ROWS = 500` first page, `result.fetchMore {handle, all}` adds a page or drains to `RESULT_FETCH_ALL_CAP = 100_000`. The old `RESULT_FETCH_CAP` goes away. Both constants live in core and are mirrored and pinned in `protocol.ts`                                                                                                                                                                                                                     |
| 2   | `ExecutedStatement` and a new `ResultState` carry `rowCount`, `complete` (iterator exhausted) and `cursorOpen`. The footer reads `500+ rows`, `1,000+ rows`, `5,000 rows`, or `500+ rows · fetching stopped`                                                                                                                                                                                                                                                                                        |
| 3   | The engine closes a session's open cursor before that session runs anything, and on release, commit, rollback, mode switch and close. `ResultStore` tracks the open iterator per handle; the engine tracks the open handle per session                                                                                                                                                                                                                                                              |
| 4   | Grid toolbar above the rows, DataGrip order: Fetch Next Page, Fetch All, Rerun, Cancel fetch (while a fetch runs), the row-count label, then on the right the extractor dropdown, Copy, Export, and Value panel toggle. Every button is an action (decision 015)                                                                                                                                                                                                                                    |
| 5   | Local sort: `result.sort {handle, keys: {column, direction}[]}`. Header click cycles ascending, descending, none; ⌥-click adds or cycles a secondary key. The header shows an arrow and a key number when there are several. Comparator in `core/results/compare.ts` picks a strategy per column type: integer and float types numeric, `numeric`/`decimal` exact digit comparison on the text form (decision 017), boolean, everything else by code point. `NULL` last ascending, first descending |
| 6   | Sorting a partly fetched result sorts what is loaded; the label adds `sorted locally`. Fetching more after a sort re-applies it                                                                                                                                                                                                                                                                                                                                                                     |
| 7   | Row-number gutter on the left, sticky. Column headers show the name; the tooltip shows `name: type`. A small type glyph (number, text, date, bool, json, bytes) precedes the name, chosen by the same type classifier the comparator uses                                                                                                                                                                                                                                                           |
| 8   | Columns resize by dragging the header's right edge (min 40 px, double-click fits content). Header context menu: Sort Ascending, Sort Descending, Clear Sort, Hide Column, Show All Columns, Copy Column Name. Hidden columns are left out of copy and export. Widths, hidden columns and sort live per result tab in the renderer and die with the tab. Reordering columns is out of scope                                                                                                          |
| 9   | Selection is a rectangle of cells, DataGrip-style: click, shift-click, drag, arrow keys and shift-arrows, ⌘A selects all fetched rows, clicking a row number selects the row, clicking a header with ⌘ selects the column. Moving the cursor is component behaviour, not an action; anything that does work (copy, select all, export) is                                                                                                                                                           |
| 10  | Extractors live in `core/results/extract/`: CSV (RFC 4180, header row), TSV (tabs and newlines escaped as `\t` `\n`), JSON (array of objects; `json` values embedded parsed, bigint and decimals as strings, bytes as `0x…` hex), SQL INSERT (one statement per row, table `MY_TABLE` as DataGrip does), Markdown (pipe-escaped, header separator). They are pure functions over columns and rows plus a dialect for SQL                                                                            |
| 11  | The plugin's `language` gains `quoteIdentifier(name)` and `literal(value, columnType)`, so SQL INSERT quotes per dialect (Postgres `"x"`, `'\x…'::bytea`; MySQL `` `x` ``, `X'…'`, backslash-escaped strings; SQLite `"x"`, `X'…'`). Built on helpers in `@table-craft/plugin-api/sql`. `API_VERSION` 0.6.0                                                                                                                                                                                         |
| 12  | The chosen extractor is one global setting, persisted in the layout store, and drives both Copy and Export, as in DataGrip. Default CSV                                                                                                                                                                                                                                                                                                                                                             |
| 13  | Copy: `result.extract {handle, extractor, rows: {from, to}[], columns: number[]}` returns the text; the renderer writes it with `navigator.clipboard.writeText`. The renderer sends ranges and column indexes, never rows. `MAX_COPY_ROWS = 100_000`, above which the copy action is disabled with a reason                                                                                                                                                                                         |
| 14  | Export: action `grid.export` asks main for a path (`dialog.saveFile` invoke channel, default name `<result title>.<ext>`), then `result.export {handle, extractor, path, columns}`; the engine writes fetched rows, then drains an open cursor straight into the file with no cap, then reports `{rows, bytes, elapsedMs}`, shown as a toast-style line in the Output log. Rows never cross the renderer (decision 009)                                                                             |
| 15  | Value panel: a right-hand split inside the result area, toggled by `grid.toggleValuePanel` (⇧↵ in the grid). It shows the focused cell: JSON pretty-printed in a read-only CodeMirror, text wrapped, bytes as hex preview plus `32 of 2,048 bytes shown`, `NULL` as the muted NULL text. Full blob values are out of scope                                                                                                                                                                          |
| 16  | `NULL` renders as `<null>` in the muted ink, italic, distinct from the string `'<null>'`. A design token, not a literal                                                                                                                                                                                                                                                                                                                                                                             |
| 17  | Window eviction: each result tab keeps at most `MAX_LOADED_WINDOWS = 20` windows (10,000 rows); the window furthest from the viewport goes first and is fetched again on return                                                                                                                                                                                                                                                                                                                     |
| 18  | When the engine behind a result exits, the result tab keeps its loaded windows, shows a muted banner `Results from a closed connection; rerun to refresh`, and stops fetching. Rerun reconnects (decision 021)                                                                                                                                                                                                                                                                                      |
| 19  | Rerun (`grid.rerun`, ⌘R in the grid) re-executes the statement that produced the tab in place, keeping the tab's widths, hidden columns and sort                                                                                                                                                                                                                                                                                                                                                    |
| 20  | Grid shortcuts, active only when the grid has focus: ⌘C copy, ⌘A select all, ⇧↵ value panel, ⌘R rerun. The keymap clash test learns the `grid` region the way plan 006 taught it `editor`                                                                                                                                                                                                                                                                                                           |

### Consequences worth naming

**This changes the plugin contract.** `language.quoteIdentifier` and `language.literal` become
required for plugins with `sql`. `API_VERSION` 0.6.0; all three built-ins implement them, and the
contract suite checks a round trip: a type_probe row turned into an `INSERT`, executed into a copy
table, reads back equal.

**This crosses the fence.** New requests `result.fetchMore`, `result.sort`, `result.extract`,
`result.export`; `ExecutedStatement` loses `truncated` and gains `complete` and `cursorOpen`. New
main invoke channel `dialog.saveFile`.

**This is a behaviour change.** A query that used to return 10,000 rows now shows 500 and asks.
Batches keep only a page for every result but the last (decision 025).

**This default was chosen without asking.** Page size 500 and the 100,000 fetch-all cap; both
become settings in plan 013. CSV as the default extractor. `NULL` sorts last ascending.

---

## Phase 0 — lazy cursors and local sort in core

| File                          | Responsibility                                                                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `core/src/results/store.ts`   | `put(result, pageRows)` fetches one page and keeps the iterator; `fetchMore(handle, {all})`; `closeCursor(handle)`; `sort(handle, keys)` builds a permutation that `window` reads through; `release` closes the iterator |
| `core/src/results/compare.ts` | `typeClass(columnType)` → `integer` / `float` / `decimal` / `boolean` / `temporal` / `json` / `bytes` / `text`; `compareValues(a, b, typeClass)`                                                                         |
| `engine/engine.ts`            | close a session's open cursor before `statement.execute`, `transaction.*`, `session.close`; new request handlers                                                                                                         |

```ts
export interface ResultState {
  readonly rowCount: number;
  readonly complete: boolean;
  readonly cursorOpen: boolean;
}
export interface SortKey {
  readonly column: number;
  readonly direction: "asc" | "desc";
}
```

| Situation                                               | Result                                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1,200-row result, page 500                              | first page 500, `complete` false, `cursorOpen` true                                      |
| fetchMore twice                                         | 1,200, `complete` true, `cursorOpen` false                                               |
| fetchMore `all` on 200,000 rows                         | 100,000, `complete` false, `cursorOpen` false, label `100,000+ rows · fetch cap reached` |
| another statement on the session                        | first result `cursorOpen` false, rows kept                                               |
| sort on decimals `9.5`, `10.25`, `NULL`, `-3` ascending | `-3`, `9.5`, `10.25`, `NULL`                                                             |
| sort, then fetchMore                                    | new rows merged into the sorted order                                                    |

## Phase 1 — extractors and the plugin literal

- `core/src/results/extract/{csv,tsv,json,sqlInsert,markdown,index}.ts`: `extract(kind, columns,
rows, dialect?)` returns a string; a streaming variant writes chunks for export.
- `plugin-api/src/plugin.ts`: `SqlLanguage.quoteIdentifier`, `SqlLanguage.literal`.
  `plugin-api/src/sql/literals.ts` with shared helpers. Each plugin wires its dialect.
- Engine: `result.extract`, `result.export` (fs write stream, `.tmp` then rename, removed on
  failure).
- Main: `dialog.saveFile` invoke channel.

## Phase 2 — the grid

| File                              | Responsibility                                                                                                                                                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `renderer/grid/ResultGrid.tsx`    | gutter, headers with glyph and sort marker, resizable columns, selection rendering, banner                                                                                                                                                      |
| `renderer/grid/GridToolbar.tsx`   | fetch, rerun, label, extractor dropdown, copy, export, value panel                                                                                                                                                                              |
| `renderer/grid/ValuePanel.tsx`    | focused cell, CodeMirror read-only for JSON                                                                                                                                                                                                     |
| `renderer/model/gridSelection.ts` | pure rectangle selection: anchor, focus, extend, ranges for `result.extract`                                                                                                                                                                    |
| `renderer/model/columnLayout.ts`  | widths, hidden set, fit-to-content                                                                                                                                                                                                              |
| `renderer/state/consoles.ts`      | per-tab `ResultState`, sort keys, layout, selection, window eviction, `stale` flag on engine exit                                                                                                                                               |
| `renderer/actions/gridActions.ts` | `grid.fetchNextPage`, `grid.fetchAll`, `grid.rerun`, `grid.copy`, `grid.selectAll`, `grid.export`, `grid.toggleValuePanel`, `grid.setExtractor`, `grid.sort`, `grid.clearSort`, `grid.hideColumn`, `grid.showAllColumns`, `grid.copyColumnName` |

## Phase 3 — Fixtures, tests, docs

Fixture schema: none of the shared tables change. A new contract case creates and drops its own
`type_probe_copy`.

New `test/core/results.test.ts` cases, `test/core/compare.test.ts`, `test/core/extract.test.ts`,
`test/renderer/gridSelection.test.ts`, `test/renderer/columnLayout.test.ts`.

New cases:

`givenLargeResult_whenExecuted_thenFirstPageOnlyAndCursorOpen`,
`givenOpenCursor_whenFetchMore_thenNextPageAppended`,
`givenOpenCursor_whenFetchAll_thenStopsAtCapWithCursorClosed`,
`givenOpenCursor_whenSessionRunsAnotherStatement_thenCursorClosedRowsKept`,
`givenOpenCursor_whenReleased_thenIteratorReturned`,
`givenDecimalTextColumn_whenSortedAscending_thenNumericOrderNullsLast`,
`givenSortedResult_whenFetchMore_thenNewRowsTakeSortedPositions`,
`givenTwoSortKeys_whenSorted_thenSecondaryBreaksTies`,
`givenFieldWithCommaQuoteNewline_whenCsv_thenRfc4180Quoted`,
`givenJsonAndBigint_whenJsonExtractor_thenJsonEmbeddedBigintString`,
`givenTypeProbeRow_whenSqlInsertPerDialect_thenRoundTripsEqual` (contract, all three databases),
`givenPipeInValue_whenMarkdown_thenEscaped`,
`givenHiddenColumn_whenExtracted_thenOmitted`,
`givenAnchorAndShiftArrow_whenExtended_thenRectangleRanges`,
`givenTwentyOneWindows_whenAnotherLoads_thenFurthestEvicted`,
`givenEngineExited_whenResultShown_thenStaleAndNoFetch`,
`givenGridFocused_whenModC_thenGridCopyNotEditorCopy`.

Docs: specification gains a "Result grid" section (page/cap, footer states, extractors, protocol
requests). design-system.md gains grid tokens (gutter, selection, sort marker, NULL text, banner).
AGENTS.md layout notes `core/results/extract/`.

Every phase ends with `bun run typecheck` and `bun run test` both green; phases 0 and 1 also run
`bun run test:db`.

---

## Live test

New `test/e2e/grid.smoke.test.ts`, `evidenceFor("007")`, 1200×800. The fixture query for paging is
`SELECT g AS n, md5(g::text) AS hash FROM generate_series(1, 50000) g` on Postgres, a recursive CTE
on SQLite and MySQL.

| #   | Scenario                                                                                                | Database | Result | Evidence                |
| --- | ------------------------------------------------------------------------------------------------------- | -------- | ------ | ----------------------- |
| 1   | 50,000-row query shows `500+ rows`; Fetch Next Page → `1,000+`; Fetch All → `50,000 rows`               | postgres |        | paged-fetch.png         |
| 2   | Big query then `SELECT 1` in the same console: Result 1 says `fetching stopped`                         | postgres |        | cursor-closed.png       |
| 3   | Sort `orders.total` descending: `100.00` above `99.50`, `NULL` first                                    | postgres |        | sort-decimal.png        |
| 4   | ⌥-click second key: ties on `customer_id` ordered by `id`, markers 1 and 2                              | mysql    |        | sort-two-keys.png       |
| 5   | Resize a column, hide one, Show All Columns restores it                                                 | sqlite   |        | columns-resize-hide.png |
| 6   | Drag-select 3×2, ⌘C: clipboard holds CSV with header                                                    | postgres |        | copy-csv.png            |
| 7   | Extractor SQL INSERT, copy two type_probe rows: backticks, `X'…'` literals                              | mysql    |        | copy-sql-insert.png     |
| 8   | Extractor JSON and Markdown copies of the same block                                                    | sqlite   |        | copy-json-markdown.png  |
| 9   | Export the 50,000-row result to CSV (save dialog stubbed): file has 50,001 lines while the grid had 500 | postgres |        | export-csv.png          |
| 10  | Value panel on a `jsonb` cell pretty-prints; on a `bytea` cell shows hex and byte count                 | postgres |        | value-panel.png         |
| 11  | `NULL` and the string `'<null>'` look different                                                         | sqlite   |        | null-display.png        |
| 12  | Disconnect the datasource: banner shown, rows stay, fetch buttons disabled; Rerun reconnects            | postgres |        | stale-result.png        |
| 13  | Fetch All 100,000 rows, scroll top → bottom → top: rows render, never more than 20 windows held         | sqlite   |        | scroll-eviction.png     |
| 14  | Rerun keeps widths, hidden column and sort                                                              | mysql    |        | rerun-keeps-layout.png  |

---

## Deviations taken while implementing

---

## Out of scope

- Editing cells, insert, delete, WHERE/ORDER BY bars, server-side sort, FK navigation: plan 008.
- Transpose and single-record view, aggregate view, charts, compare data: later.
- Text search and local filter inside a result: later; the decision is an engine-side filter over
  the permutation, reusing the comparator.
- Full blob and large-text values beyond what the wire value carries: needs a `result.value`
  request and a plugin hook; later.
- Column reordering by drag: later.
- Custom extractors, XLSX, HTML, XML: later.
- Page size and cap settings, date and number formats: plan 013.
