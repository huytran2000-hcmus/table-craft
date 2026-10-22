# Plan: Query history, the Services session tree, and reopening closed consoles

Status: done. Every statement a console runs on a saved datasource, and every table-editor submit,
lands in `<userData>/history.sqlite`, kept by core's `history/` through `node:sqlite` in main and
written by the renderer over `history.record` after the fact, fire-and-forget: success, error or
cancelled, the statement's own duration, its rows and the error's message, 10,000 entries per
datasource, a corrupt file set aside. ⌥⌘E, in a console or on a datasource in the Database pane,
opens Query History: distinct statements newest first with outcome dot, `×N`, rows, duration and
time, a literal case-insensitive search, the selected one in a read-only SQL view with its error,
and Insert at the console's caret (one undo step), Open in Console, Copy or Clear History…. The
Services tool window is now a session tree: each datasource with open tabs, a session per console
or table tab with its state and last duration, and its last 50 executions (statements, `Load rows`,
`Count rows`, `Submit N statements`) with a spinner and elapsed time ticking while they run; a
click activates the tab, and context menus cancel, clear, copy the SQL or open it in a console.
Open Closed Console… lists a datasource's saved console files no tab holds, with a preview, and
reopens or deletes them. Deleting a datasource deletes its history and says so.

## The issue

Nothing a user ran survives the run. The Output tab is per console, in memory, capped at 500 lines
and "never written to disk" (`renderer/state/consoles.ts:78-79,148`). Close the console, quit, or
lose the engine, and the statement that found last week's bad rows is gone. No history module exists
anywhere: decision 010 reserves `<userData>/history.sqlite` and decision 004 gives history to core,
but `packages/core/src` has none.

Services is a flat list of console tabs with one word and the last run's duration
(`renderer/panes/ServicesPane.tsx:21-67`, `model/format.ts:101-107`). It shows no statement, no
start time, no rows, and nothing for a table tab: the table editor's loads, counts and submits
(`renderer/state/tables.ts:344-350,650,670`) leave no record anywhere. `LastRun` is overwritten on
every run (`consoles.ts:55-58,513-517`) and spans the whole run, including the destructive-statement
confirmation.

A console tab that is closed keeps its file (`docs/design/specification.md:575-583`), but nothing
lists those files, so it can never be opened again.

Decision 014 ships "Query history per datasource, and a Services window listing sessions and
executions with timings" (`docs/decisions/014-what-v1-ships.md:23`). Plan 006 deferred query history,
the Services session tree and "opening console files closed earlier from a list" here
(`docs/plans/006-sql-console.md:292-298`). DataGrip's model (`docs/design/datagrip-inventory.md`
:358, :377, :470, workflow 17 at :1085): a Query History popup per data source, searchable, that
restores a statement into the console.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | History is `<userData>/history.sqlite`, opened by main through `node:sqlite`; its logic is `@table-craft/core` `history/`; the renderer records after the fact, fire-and-forget (decision 030)                                                                                                                                                                                                                                                                                                                                             |
| 2   | One table, `PRAGMA user_version = 1`, WAL: `entries(id INTEGER PRIMARY KEY, datasource_id TEXT, sql TEXT, started_at INTEGER, duration_ms INTEGER, outcome TEXT, row_count INTEGER NULL, message TEXT NULL, source TEXT)`, index on `(datasource_id, started_at)`. `outcome` is `success \| error \| cancelled`; `source` is `console \| table`. A file that does not open as this schema is renamed `history.sqlite.corrupt-<ms>` and a fresh one created, as `datasources.json` does (`main/datasources.ts:115-122`)                     |
| 3   | Every execution is a row. Past `HISTORY_LIMIT = 10_000` rows for a datasource, the insert deletes its oldest                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 4   | Search answers distinct statements for one datasource, newest first: `{ sql, lastStartedAt, lastDurationMs, lastOutcome, lastMessage, runs }`, grouped on exact text, filtered by a case-insensitive substring (`instr(lower(sql), lower(?))`, so `%` and `_` are literal), at most `HISTORY_SEARCH_LIMIT = 200`                                                                                                                                                                                                                           |
| 5   | Main invoke channels `history.record`, `history.search`, `history.clear` (`preload/bridge.ts:22-37`, `main/ipc.ts` with zod). Deleting a datasource clears its history beside `consoles.deleteAll` (`main/service.ts:216`), and the delete confirmation says so                                                                                                                                                                                                                                                                            |
| 6   | What is recorded: each statement a console runs (Run, Run All, rerun), once it succeeds, fails or is cancelled, with the full statement text as sent. Not recorded: statements skipped after an error, a declined destructive confirmation, "nothing to run", table loads and counts. A table-editor submit is one entry, `source: table`, whose text is `SubmittedEdits.statements` joined as a script (each ending in `;`, one per line), so restoring it runs as it ran                                                                 |
| 7   | Duration is per statement, measured as Output measures it (`consoles.ts:347,354`): the console's round trip, without the confirmation dialog. `row_count` is `rowCount` for a result set, `rowsAffected` otherwise; `message` is the error's message. Consoles on the `TABLE_CRAFT_DATASOURCE` datasource record nothing (decision 018, as their files)                                                                                                                                                                                    |
| 8   | Action `history.show` "Query History…", ⌘⌥E, in a console (tab kind `console`) and on a selected datasource in the Database pane (its context menu and the palette). A dialog: a search field, the list (first line of the statement, time — `HH:MM:SS` today, else `YYYY-MM-DD HH:MM` — duration, outcome dot, `×N` when run more than once), and the selected statement in full in a read-only `ui/SqlView.tsx` below                                                                                                                    |
| 9   | In the history dialog ↑/↓ move, Enter restores: from a console it replaces the selection at the caret (or inserts at the caret) and focuses the editor; from the Database pane it opens a new console on the datasource with the text. Buttons: Insert (or Open in Console), Copy, Clear History…. Clear asks "Clear the query history of pg? This cannot be undone." through `useModal`                                                                                                                                                   |
| 10  | The consoles store gains `insert(id, text)`: a one-shot request the editor applies at its selection (like `jumpTo`, `consoles.ts:106`), not a whole-document `setSql`, so undo takes it back in one step                                                                                                                                                                                                                                                                                                                                   |
| 11  | A new renderer store `state/executions.ts` keeps, per open tab, its last `EXECUTIONS_PER_SESSION = 50` executions in memory: `{ id, startedAt, durationMs \| null, outcome: running \| success \| error \| cancelled, label, sql \| null, rowCount \| null, message \| null }`. Consoles report each statement (label: its first line); tables report Load (label "Load rows", `sql` from `TableQuery.sql`), Count ("Count rows") and Submit ("Submit N statements", the script). Closing a tab drops its executions; they are never saved |
| 12  | Services becomes a tree (`role="tree"`, the Database pane's keyboard model): datasource → session → executions. A datasource appears while it has an open console or table tab, with its connection state. A session is one console or table tab: glyph by kind, tab title, state (`serviceState`), last duration. Executions are newest first: outcome glyph (spinner while running, with elapsed ticking each second), label, rows, duration, start time. Datasources and sessions start expanded                                        |
| 13  | In Services, Enter or a click on a session activates its tab; on an execution, activates its tab too. Context menu: on a session, Cancel (when running; the existing console cancel or the table's) and Clear Executions; on an execution with `sql`, Copy SQL and Open in Console. The empty state reads "No open sessions."                                                                                                                                                                                                              |
| 14  | Action `console.reopen` "Open Closed Console…", on a datasource (Database pane context menu, palette; also from a console, for its datasource): a dialog listing the datasource's console files that no tab has open (`listConsoles`, `main/consoleFiles.ts`), by name, with the selected file's text in `ui/SqlView.tsx`. Enter opens it as a tab under its own name with its text; Delete… removes the file after confirmation                                                                                                           |
| 15  | The history and reopen dialogs share one `ui/ListPicker.tsx`: search field, keyboard list, preview slot, footer buttons; themed from tokens. The datasource context menu (`panes/DatabasePane.tsx:68-79`) gains Query History… ⌘⌥E and Open Closed Console… after New Console                                                                                                                                                                                                                                                              |

### Consequences worth naming

**The plugin contract does not change**, and no engine request is added. History crosses into main,
not the engine: three new invoke channels and a `TableCraftBridge` growth
(`preload/bridge.ts:150-183`).

**This is a behaviour change.** Services is a tree, lists table tabs, and its empty state changes
from "No open consoles."; `shell.databases.smoke.test.ts:56-64,157` look for the old listbox and
change with it. Deleting a datasource now also deletes its history.

**This default was chosen without asking.** The 10,000-row and 200-result caps; table loads and
counts kept out of history (they are generated reads, but stay visible in Services); one history
entry per submit; history text kept verbatim and unencrypted (decision 030).

**Main does synchronous SQLite work.** One insert per statement and one query per search keystroke
(debounced 150 ms in the dialog); nothing else in main touches a database.

---

## Phase 0 — history in core

| File                                             | Responsibility                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| `core/src/history/history.ts`                    | `openQueryHistory(path)`: schema, `record`, `search`, `clear`, `close`; pruning |
| `core/src/history/index.ts`, `core/src/index.ts` | exports, `HISTORY_LIMIT`, `HISTORY_SEARCH_LIMIT`                                |

```ts
export interface HistoryEntry {
  readonly datasourceId: string;
  readonly sql: string;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly outcome: "success" | "error" | "cancelled";
  readonly rowCount: number | null;
  readonly message: string | null;
  readonly source: "console" | "table";
}
export interface HistoryStatement {
  readonly sql: string;
  readonly lastStartedAt: number;
  readonly lastDurationMs: number;
  readonly lastOutcome: HistoryEntry["outcome"];
  readonly lastMessage: string | null;
  readonly runs: number;
}
export interface QueryHistory {
  record(entry: HistoryEntry): void;
  search(datasourceId: string, query: string, limit?: number): readonly HistoryStatement[];
  clear(datasourceId: string): void;
  close(): void;
}
export function openQueryHistory(path: string, options?: { limit?: number; now?: () => number }): QueryHistory;
```

Unit tests on `:memory:` and on a temp file (for the corrupt-file rename).

## Phase 1 — main and the bridge

- `main/main.ts`: open history at `<userData>/history.sqlite` after `userData` is set, close it on
  quit.
- `preload/bridge.ts`: `historyRecord`, `historySearch`, `historyClear` channels and bridge methods;
  `main/ipc.ts`: their zod schemas and handlers; `preload/preload.ts` and `renderer/bridge.ts`.
- `main/service.ts:216`: delete clears history; the delete confirmation names it.

## Phase 2 — recording in the renderer

- `state/executions.ts` (decision 11), and `state/history.ts`: a thin client over the bridge
  (`record` swallows and logs a failure; `search`, `clear` surface typed errors).
- `state/consoles.ts`: `execute` (`:338-396`) and `rerun` (`:567-632`) report each statement's start
  and end to executions and its end to history (decision 6–7); `insert(id, text)` (decision 10);
  `console/Editor.tsx` applies it.
- `state/tables.ts`: load (`:344-350`), count (`:670`) and submit (`:650`) report to executions;
  submit records history.
- `state/wiring.ts`: a closed tab drops its executions.

## Phase 3 — the views and actions

- `ui/ListPicker.tsx`; `dialogs/QueryHistory.tsx`; `dialogs/OpenClosedConsole.tsx`, as modal kinds
  in `state/modal.ts`.
- `panes/ServicesPane.tsx` rewritten as the tree (decisions 12–13), with `model/servicesTree.ts`
  building rows from tabs, consoles, tables, executions and datasources.
- `actions/historyActions.ts`: `history.show` (⌘⌥E), `history.clear`, `console.reopen`,
  `services.cancel`, `services.clearExecutions`, `services.copySql`, `services.openInConsole`.
  `test/renderer/keymap.test.ts` stays green; `Mod+Alt+E` is free today.
- `panes/DatabasePane.tsx`: decision 15's menu items; the native menu (`preload/menu.ts`) gains
  Query History… under View or Tools, beside Services.
- Design tokens for the outcome glyphs and the picker in `docs/design/design-system.md`.

## Phase 4 — Fixtures, tests, docs

No fixture schema change.

New cases:

`givenStatementsRecorded_whenSearched_thenNewestFirstAndGroupedByText`,
`givenQueryWithPercent_whenSearched_thenMatchesLiterally`,
`givenMoreThanLimit_whenRecorded_thenOldestPruned`,
`givenTwoDatasources_whenOneCleared_thenOtherKept`,
`givenCorruptFile_whenOpened_thenRenamedAndFresh`,
`givenDatasourceDeleted_whenSearched_thenEmpty`,
`givenScriptWithFailingSecondStatement_whenRun_thenFirstTwoRecordedThirdSkipped`,
`givenDestructiveDeclined_whenRun_thenNothingRecorded`,
`givenEnvironmentDatasource_whenRun_thenNothingRecorded`,
`givenHistoryWriteFails_whenRun_thenRunSucceeds`,
`givenTableSubmit_whenRecorded_thenOneEntryWithTheScript`,
`givenTableLoad_whenRun_thenExecutionWithSqlAndNoHistory`,
`givenMoreThanFiftyExecutions_whenReported_thenOldestDropped`,
`givenTabClosed_whenReading_thenItsExecutionsGone`,
`givenConsoleAndTableTabs_whenBuildingServicesTree_thenGroupedByDatasource`,
`givenSelection_whenInserting_thenReplacedAndUndoneInOneStep`,
`givenOpenConsole_whenListingClosed_thenExcluded`.

Docs: specification gains a "Query history and Services" section (the store, channels, what is
recorded, the dialog, the tree, Open Closed Console), replaces the Services sentence at
`specification.md:369-372`, adds the actions to the action table and the menus, and the Console
files section says how a closed console reopens; design-system gains the outcome glyphs and the
picker; `AGENTS.md`'s layout notes main's history channels.

Every phase ends with `bun run typecheck` and `bun run test` both green.

---

## Live test

Run with `TABLE_CRAFT_EVIDENCE_DIR=docs/evidence/011 bun run test:smoke:db`, suite
`test/e2e/history.smoke.test.ts`, 1200×800.

| #   | Scenario                                                                                       | Database | Result | Evidence                 |
| --- | ---------------------------------------------------------------------------------------------- | -------- | ------ | ------------------------ |
| 1   | Run three statements; ⌘⌥E lists them newest first with time, duration, rows and outcome        | pg       | Pass. Three statements run on pg are listed newest first, each with a green dot, rows (`1 row`, `3 rows`, `2 rows`), duration in ms and `HH:MM:SS`; the selected one shows in the preview | history-dialog.png       |
| 2   | Typing `orders` in the search field leaves only statements on `orders`                         | pg       | Pass. Typing `ORDERS` (upper case, so also case-insensitive) leaves the two statements on `orders` | history-search.png       |
| 3   | Enter on an entry puts it at the caret in the console; ⌘↵ runs it                              | pg       | Pass. Searching `customers` and Enter puts the statement in the console at the caret; ⌘↵ runs it and the grid shows Ada and Grace | history-insert.png       |
| 4   | After relaunch on the same profile, the history still lists the earlier statements             | mysql    | Pass. After relaunching on the same profile, mysql still disconnected, its two statements are listed; the button reads Open in Console | history-persists.png     |
| 5   | A failed statement is listed with the error outcome and its message                            | sqlite   | Pass. The failed statement has a red dot and `no such table: no_such_table` above its preview | history-error.png        |
| 6   | Query History… from the datasource's context menu; Enter opens a new console with the text     | mysql    | Pass. Query History… from the mysql node's context menu; Enter opens `console_1 [mysql]` holding the statement | history-from-pane.png    |
| 7   | A table-editor submit appears in history as the generated script                               | pg       | Pass. Editing `orders.total` to 25.00 and submitting lists one entry, `UPDATE "public"."orders" SET "total" = '25.00' WHERE "id" = 1;`, 1 row; Services shows Load rows and Submit 1 statement | history-table-submit.png |
| 8   | Services shows pg → `console` and `orders` sessions, with their executions, rows and durations | pg       | Pass. pg holds `console` (idle, two executions with `1 row` and `2 rows`) and `orders` (idle, Load rows with `3 rows`), each with durations and start times | services-tree.png        |
| 9   | `SELECT pg_sleep(2)` shows as running with a spinner and ticking elapsed, then success at ~2 s | pg       | Pass. While running, session and execution show a spinner and the elapsed time ticks (`1.0 s` captured); the execution then reads success at about 2 s and the session idle | services-running.png     |
| 10  | Clicking a session in Services activates its tab                                               | sqlite   | Pass. Clicking the first sqlite `console` session activates its tab and shows its grid; the row is selected | services-activate.png    |
| 11  | Close a console with text; Open Closed Console… lists it with a preview; Enter restores it     | mysql    | Pass. `console_1`, closed holding `-- kept for later` and a SELECT, is listed by Open Closed Console: mysql with its text in the preview; Enter reopens it as `console_1 [mysql]` with the text | reopen-console.png       |
| 12  | Clear History…, confirmed, empties the list                                                    | sqlite   | Pass. Clear History… asks `Clear the query history of sqlite? This cannot be undone.`; after Clear the picker shows `No statements yet.` | history-cleared.png      |

Bugs found while testing are fixed with a regression test and listed under Deviations.

---

## Deviations taken while implementing

**1. A history statement carries its last row count.** Decision 4's search answer had no rows, but
the dialog (decision 8, Live test row 1) shows them. `HistoryStatement` gains `lastRowCount`,
selected from the newest entry like the other `last*` fields, in core and in the bridge's mirror.

**2. The store says when it set a file aside.** `QueryHistory` exposes `recoveredFrom`, the path a
corrupt `history.sqlite` was renamed to (or `null`), and main logs it at launch. A file that is
SQLite but not this schema (another `user_version` or other columns) counts as corrupt too
(`test/core/history.test.ts`).

**3. A failed table submit is not recorded.** Decision 6 records a submit as its script, but a
rejected submit rolls back and the engine answers with the error, not the statements, so there is
no script to record. It shows in Services as a `Submit changes` execution with the error;
`givenRejectedSubmit_whenSubmitted_thenErrorExecutionAndNoHistory` pins it.

**4. Cancel in Services is for consoles only.** Decision 13 offers the table's cancel too, but the
tables store has none: loads, counts and submits are not cancellable today. Cancel Running
Statement shows on a running console session; adding a table cancel is out of this plan's scope.

**5. Where a restored statement goes depends on focus.** `ActionContext` gains `inDatabasePane`.
Query History… inserts into the active console when it runs on that console's datasource with focus
outside the Database pane, and otherwise opens a new console (button Open in Console). It is
enabled on any datasource, the `TABLE_CRAFT_DATASOURCE` one included, where it lists nothing
(`givenEphemeralDatasource_whenRunAndQueryHistoryOpened_thenNothingRecorded` in the smoke suite).
Clear Query History… and Open Closed Console… need a saved datasource.

**6. The pickers answer; the actions act.** As with the SQL Generator, the dialogs' buttons answer
the modal with a choice and a value (`HISTORY_CHOICES`, `CLOSED_CONSOLE_CHOICES`) and the action
does the work (decision 015). Clear History… and Delete… confirm through `useModal` and then show
the picker again, emptied or without the deleted file. Open Closed Console flushes pending
autosaves before listing, so a console closed a moment ago is not missed. A reopened console
connects as New Console does.

**7. Services actions are registered actions with row arguments.** `services.cancel`,
`services.clearExecutions`, `services.copySql` and `services.openInConsole` take `{ tabId,
executionId }` from the clicked row and, from the palette, fall back to the active tab and its
newest execution with SQL. The native menu carries Query History… and Open Closed Console… under
View. The session row's duration is the console's last run (the whole batch, as before); an
execution's is its statement's alone.

**8. Bug: the completion popup opened over dialogs.** Seen in the first `history-cleared.png` and
`history-table-submit.png`: an engine completion answer that arrived after the editor lost focus
(Run All clicked right after typing, a dialog opening) opened the popup over the dialog, because
CodeMirror closes it on blur only when it is already open. `engineCompletionSource` now drops an
answer when its view no longer has focus;
`givenEditorLostFocus_whenResponseArrives_thenDropped` in `test/renderer/completionSource.test.ts`.

**9. Smoke suites that read Services.** `test/e2e/shell.databases.smoke.test.ts` counted Services'
flat rows; it now counts the tree's session items (`[role="treeitem"][data-kind="session"]`).

---

## Out of scope

- A per-console current schema or database switcher: not in decision 014's v1 list, and it needs a
  plugin contract for setting the session's namespace; add it to 014 first.
- Choosing or sharing a session between consoles: each console owns its session (decision 002).
- Saved query files outside the profile: v1.1 (decision 014).
- History across all datasources in one list, history export, and scrubbing secrets from history.
- Saving Output or Services executions across a relaunch.
- Jumping from a Services execution to its statement's range in the console text: the text may
  have changed since.
