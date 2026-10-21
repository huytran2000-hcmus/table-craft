# Plan: Make the console a real SQL editor

Status: done. The console is a CodeMirror 6 editor coloured from tokens, with the dialect the
plugin's manifest names, line numbers, bracket matching, search, multiple cursors and keyword
completion. plugin-api is `0.5.0`: every SQL plugin exports `language { split, classify }` built
on the shared tokenizer in `@table-craft/plugin-api/sql`, and declares `transactions`, which the
contract suite checks against all three databases. ⌘↵ runs the statement at the caret or the
selection and flashes it, ⇧⌘↵ runs the script; statements run in order, stop at the first error,
and ask once before anything destructive. Results are `Output` plus one tab per row-returning
statement, pinnable. The toolbar switches between auto and manual commit, with Commit, Rollback and
a `transaction open` badge, and closing a console, disconnecting or quitting with an open
transaction asks first (decision 024). Consoles autosave per datasource and reopen on launch without
connecting. DDL refreshes the tree, and tree items drag into the editor as qualified names. All
fourteen live-test rows pass; the screenshots exposed six bugs, fixed below.

## The issue

The console is a `<textarea>` (`packages/desktop/src/renderer/console/Console.tsx:84`) that sends
its whole text as one statement (`state/consoles.ts:176`). There is no highlighting, no way to run
one statement out of several, and a script with two statements fails or runs as one string,
depending on the driver. Every run replaces the one result the console holds
(`state/consoles.ts:12`), so there is nowhere to see what an earlier statement did. There is no
transaction control: every statement auto-commits. Closing the tab or the app loses the text;
every new console starts from `INITIAL_SQL` (`state/consoles.ts:55`).

This is the screen a DataGrip user spends the day in: write a few statements, put the caret in
one, press ⌘↵, read the result, switch to manual commit before touching production, and find the
console as they left it the next morning.

The driving case is a console on the `test:db` PostgreSQL with three statements:

```sql
SELECT * FROM customers;
UPDATE orders SET total = total + 1 WHERE id = 1;
SELECT count(*) FROM orders;
```

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | CodeMirror 6 replaces the textarea: `@codemirror/{state,view,commands,language,lang-sql,search,autocomplete}`. The manifest's `highlight` picks the `lang-sql` dialect (`postgresql` → PostgreSQL, `mysql` → MySQL, `sqlite` → SQLite, anything else → StandardSQL). Line numbers, bracket matching, ⌘/ toggles a line comment, ⌘F search, multiple cursors, undo. Completion is `lang-sql`'s keyword list only; schema-aware completion is plan 009 |
| 2   | The editor's colours and font come from tokens (`FontTokens.editor`, new syntax colour tokens) through a CodeMirror theme built from CSS variables, so plan 013's themes restyle it without touching the editor                                                                                                                                                                                                                                      |
| 3   | Each SQL plugin exports `language: { split(text), classify(sql) }` (decision 008), built on the shared `sqlSplitter` in `@table-craft/plugin-api/sql` (decision 023). `split` returns `StatementSpan { from, to, sql }` in UTF-16 offsets; `classify` returns `{ kind: "read" \| "write" \| "ddl" \| "transaction" \| "other", destructive: string \| null }`, where `destructive` names the reason                                                  |
| 4   | Destructive, per decision 011: `UPDATE` or `DELETE` without a top-level `WHERE`, `DROP`, `TRUNCATE`. MySQL adds `DELETE … LIMIT` without `WHERE`. The classifier only looks at tokens, never parses                                                                                                                                                                                                                                                  |
| 5   | New request `script.split { text }` → `ClassifiedStatement[]` (span plus classification). The renderer sends the editor text only when the user runs; nothing goes to the engine per keystroke                                                                                                                                                                                                                                                       |
| 6   | ⌘↵ (`console.run`) with no selection runs the statement that holds the caret. A caret in whitespace or a comment between statements runs the statement before it, the same as DataGrip. With a selection it runs every statement inside the selection, in order. `console.runAll` (⇧⌘↵) runs the whole script                                                                                                                                        |
| 7   | The statement about to run flashes a short highlight in the editor, so a user who pressed ⌘↵ in the wrong place sees what ran                                                                                                                                                                                                                                                                                                                        |
| 8   | Several statements run one after another in the console's session. The first error stops the rest; the Output log says which statements were skipped                                                                                                                                                                                                                                                                                                 |
| 9   | Before any statement runs, every destructive statement in the batch is listed in one confirm dialog with its reason: Execute or Cancel. Cancel runs nothing from the batch                                                                                                                                                                                                                                                                           |
| 10  | Results become tabs under the editor: `Output`, then one tab per statement that returned rows, titled `Result 1`, `Result 2`… with the SQL in the tooltip. A new run replaces the console's unpinned result tabs and releases their handles; `result.pin` keeps a tab across runs. A statement without rows writes only to Output                                                                                                                    |
| 11  | Output is a log per console: time, first line of the SQL, then `N rows retrieved in 38 ms`, `N rows affected in 12 ms`, `cancelled`, or the error with its hint. It keeps the last 500 entries in memory and is not saved                                                                                                                                                                                                                            |
| 12  | New capability `transactions`. `Session.transactions` has `setMode("auto" \| "manual")`, `commit()`, `rollback()` and a read-only `open` flag. In manual mode the plugin starts the transaction before the first statement (`BEGIN` on PostgreSQL and SQLite, `SET autocommit = 0` on MySQL). In auto mode the plugin tracks explicit `BEGIN`/`COMMIT`/`ROLLBACK`, using `classify`                                                                  |
| 13  | Requests `transaction.setMode { sessionId, mode }`, `transaction.commit`, `transaction.rollback`. `ExecutedStatement` and every transaction response carry `transactionOpen`. Switching to auto with a transaction open asks Commit, Rollback or Cancel first                                                                                                                                                                                        |
| 14  | The console toolbar shows `Tx: Auto ▾` / `Tx: Manual ▾`, Commit (✓) and Rollback (↺), enabled only while a transaction is open, and a `transaction open` badge. Actions `transaction.commit` (⌥⇧⌘↵), `transaction.rollback`, `transaction.toggleMode`. Each new console starts in auto (decision 011)                                                                                                                                                |
| 15  | Closing a console with an open transaction asks Commit, Rollback or Cancel. Disconnecting a datasource (⌘F2) or quitting asks the same once, listing every console with an open transaction                                                                                                                                                                                                                                                          |
| 16  | Consoles autosave to `<userData>/consoles/<datasourceId>/<name>.sql` (decision 010), 500 ms after the last edit and when the tab closes. Main owns the files through invoke channels `consoles.list`, `consoles.read`, `consoles.write`, `consoles.delete`; names are checked so they cannot leave their directory. A new console takes the first free name of `console`, `console_1`, `console_2`… as DataGrip does                                 |
| 17  | Closing a tab keeps its file unless the text is empty, which deletes it. The layout store remembers open console tabs (datasource id, name, which one is active). On launch they reopen with their text and their datasource disconnected; the first Run connects (decision 021). Launch therefore makes no connections                                                                                                                              |
| 18  | Deleting a datasource deletes its console directory, and the delete confirmation says so when that directory has files                                                                                                                                                                                                                                                                                                                               |
| 19  | A successful `ddl` statement re-describes the console's namespaces that are already cached, when the transaction is not open (auto mode, or after Commit). The tree updates without a Synchronize; while a manual transaction is open it waits for the commit                                                                                                                                                                                        |
| 20  | Dragging a relation, view or column from the Database pane into the editor inserts its qualified name from `catalog.qualifiedName` at the drop point                                                                                                                                                                                                                                                                                                 |
| 21  | The registry yields to the editor for the chords CodeMirror binds (`Mod+Z`, `Mod+Shift+Z`, `Mod+A`, `Mod+F`, `Mod+/`, `Mod+D`, `Escape` while a panel or completion is open). The list lives in `console/editorKeys.ts` and `test/renderer/keymap.test.ts` fails when a registry chord collides with it. ⌘↵, ⇧⌘↵ and ⌥⇧⌘↵ belong to the registry                                                                                                     |
| 22  | The datasource colour tints the editor's border, as the textarea's border does today. The console keeps the accessible name `SQL console` and the `Run` / `Cancel` buttons, so existing smoke tests keep working                                                                                                                                                                                                                                     |
| 23  | `API_VERSION` 0.5.0                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### Consequences worth naming

**This changes the plugin contract.** `DatasourcePlugin` gains `language`, required when `sql` is
declared. `Session` gains `transactions`, required when `transactions` is declared. The
`plugin-api/sql` subpath is new public API (decision 023). `API_VERSION` 0.4.0 → 0.5.0.

**This crosses the fence.** New engine requests: `script.split`, `transaction.setMode`,
`transaction.commit`, `transaction.rollback`. `ExecutedStatement` gains `transactionOpen`. Main gains
four `consoles.*` invoke channels.

**This is a behaviour change.** Run used to send the whole textarea; it now sends the statement at
the caret. The smoke harness's `run` helper has to select all, or call `console.runAll`, where a
test means the whole text.

**Manual mode holds locks.** A console in manual mode with an open transaction holds row locks on
PostgreSQL and MySQL until Commit or Rollback, and the explorer's own session (decision 022) cannot
see uncommitted DDL. The badge and the close and disconnect prompts are the guard.

**These defaults were chosen without asking.** The first error stops the rest of the batch.
Restored consoles do not connect. Output is not saved. Every new console starts in auto.

---

## Phase 0 — plugin-api: language, splitter, transactions

| File                                      | Responsibility                                                                                                                                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/plugin-api/src/sql/splitter.ts` | `sqlSplitter(options)` → `(text) => StatementSpan[]`: tokenizer over strings, quoted identifiers, line and block comments, dollar quotes, `DELIMITER`, `BEGIN … END` bodies. Empty statements dropped |
| `packages/plugin-api/src/sql/classify.ts` | `classifyTokens(sql, options)` → `StatementClass`: the first keyword picks the kind, and the destructive rules from decision 4                                                                        |
| `packages/plugin-api/src/sql/index.ts`    | the `./sql` export                                                                                                                                                                                    |
| `packages/plugin-api/src/plugin.ts`       | `CAPABILITIES` (line 9) gains `transactions`; `SqlLanguage`, `StatementSpan`, `StatementClass`; `DatasourcePlugin.language`; `Session.transactions?: Transactions` (line 30)                          |
| `packages/plugin-api/src/version.ts`      | `API_VERSION = "0.5.0"`                                                                                                                                                                               |

```ts
export interface SqlLanguage {
  split(text: string): readonly StatementSpan[];
  classify(sql: string): StatementClass;
}
export interface Transactions {
  setMode(mode: TransactionMode): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  readonly open: boolean;
}
```

- Each plugin wires `language` with its options: PostgreSQL dollar quotes and nested comments;
  MySQL backslash escapes, `DELIMITER`, `BEGIN … END`; SQLite `BEGIN … END` for trigger bodies.
- Each plugin implements `transactions` per decision 12 and declares `transactions`. SQLite's
  `DatabaseSync` is synchronous, so its methods resolve immediately.

## Phase 1 — engine, core, main

- `engine/protocol.ts` (`EngineCalls`, line 195): the four new requests, `ClassifiedStatement`,
  `TransactionMode`, `transactionOpen` on `ExecutedStatement` and on the transaction responses.
  `engine/requests.ts` gains their Zod schemas; `engine/engine.ts` routes them. `script.split`
  needs no session and works on a datasource whose plugin is loaded.
- An `invalidRequest` answers `transaction.*` on a session whose plugin lacks `transactions`.
- `main/consoleFiles.ts`: the four channels, atomic writes, names matching
  `CONSOLE_NAME_PATTERN = /^[\w.-]{1,64}$/`. Deleting a datasource removes its directory.

## Phase 2 — renderer

| File                              | Responsibility                                                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `renderer/console/Editor.tsx`     | the CodeMirror view: dialect from the plugin's `highlight`, token theme, drop handler for tree items, the run highlight                                  |
| `renderer/console/editorKeys.ts`  | the chords CodeMirror owns (decision 21)                                                                                                                 |
| `renderer/console/editorTheme.ts` | the CodeMirror theme and highlight style from CSS variables                                                                                              |
| `renderer/model/statementAt.ts`   | pure: given spans, caret and selection, which spans run (decision 6)                                                                                     |
| `renderer/console/ResultTabs.tsx` | Output plus result tabs, pin, and each tab's `ResultGrid`                                                                                                |
| `renderer/console/OutputLog.tsx`  | the log (decision 11)                                                                                                                                    |
| `renderer/console/TxControls.tsx` | Tx mode menu, Commit, Rollback, badge; buttons invoke actions                                                                                            |
| `renderer/state/consoles.ts`      | per console: `results: ResultTab[]`, `activeResult`, `output`, `txMode`, `transactionOpen`, `name`; `run(id, scope)` splits, confirms, executes in order |
| `renderer/state/consoleFiles.ts`  | debounced autosave, restore on launch, name allocation                                                                                                   |
| `renderer/actions/appActions.ts`  | `console.runAll`, `transaction.commit`, `transaction.rollback`, `transaction.toggleMode`, `result.pin`; `console.run` keeps its id                       |

`Console.tsx` keeps the toolbar and swaps the textarea for `Editor`. The confirm dialogs reuse the
in-app confirm from plan 004.

| Caret or selection                             | Runs                                  |
| ---------------------------------------------- | ------------------------------------- |
| Caret inside statement 2                       | statement 2                           |
| Caret in the blank line after statement 2      | statement 2                           |
| Caret before the first statement               | statement 1                           |
| Selection covering parts of statements 2 and 3 | statements 2 and 3                    |
| Selection inside one statement                 | the selected text, as one statement   |
| Empty editor                                   | nothing; Output says `Nothing to run` |

## Phase 3 — Fixtures, tests, docs

Fixture schema: unchanged. Transaction cases insert into `orders` and roll back or delete their
rows, so the fixture's row counts hold.

The contract suite gains the shared splitter scripts, the destructive cases, and transactions:
manual insert then rollback leaves no row, manual insert then commit keeps it, `open` follows both,
and auto mode tracks an explicit `BEGIN`.

New `test/plugin-api/splitter.test.ts`, `test/plugin-api/classify.test.ts`,
`test/renderer/statementAt.test.ts`, `test/renderer/consoleFiles.test.ts`,
`test/desktop/consoleFiles.test.ts`.

New cases:

`givenSemicolonInsideString_whenSplit_thenOneStatement`,
`givenSemicolonInsideLineAndBlockComment_whenSplit_thenOneStatement`,
`givenDollarQuotedFunctionBody_whenSplitAsPostgres_thenOneStatement`,
`givenDelimiterCommand_whenSplitAsMysql_thenUsesNewDelimiter`,
`givenEmptyStatements_whenSplit_thenDropped`,
`givenAstralCharacters_whenSplit_thenOffsetsAreUtf16`,
`givenDeleteWithoutWhere_whenClassified_thenDestructive`,
`givenUpdateWithWhereInSubqueryOnly_whenClassified_thenDestructive`,
`givenDropTable_whenClassified_thenDdlAndDestructive`,
`givenSelect_whenClassified_thenReadAndNotDestructive`,
`givenCaretInBlankLineAfterStatement_whenResolved_thenRunsPrecedingStatement`,
`givenSelectionAcrossTwoStatements_whenResolved_thenRunsBoth`,
`givenManualMode_whenInsertThenRollback_thenRowGoneAndNotOpen`,
`givenManualMode_whenInsertThenCommit_thenRowKept`,
`givenAutoMode_whenExplicitBegin_thenTransactionOpen`,
`givenSecondStatementFails_whenBatchRuns_thenThirdSkippedAndLogged`,
`givenDestructiveStatementCancelled_whenBatchRuns_thenNothingRuns`,
`givenUsedNames_whenNewConsole_thenFirstFreeName`,
`givenNameWithSlash_whenWritten_thenRejected`,
`givenEmptyConsole_whenClosed_thenFileDeleted`,
`givenEditorChords_whenComparedWithKeymap_thenNoClash`.

Docs: `specification.md` gains a SQL console section (run scopes, result tabs, Output, transactions,
autosave), the new requests and channels, and `API_VERSION` 0.5.0. `design-system.md` gains the
syntax colour tokens. `AGENTS.md` layout gains `plugin-api/src/sql/` and `renderer/console/`.

Every phase ends with `bun run typecheck` and `bun run test` both green; phases 0 and 1 also run
`bun run test:db`.

---

## Live test

New `test/e2e/console.smoke.test.ts`, capturing with `evidenceFor("006")` into `docs/evidence/006/`
at 1200×800. Update the shared harness's `run` helper for decision 6.

| #   | Scenario                                                                                      | Database | Result                                                                                                                                                                                              | Evidence                     |
| --- | --------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 1   | Highlighting and line numbers on a three-statement script                                     | postgres | Pass. Three lines numbered 1–3; keywords, numbers and operators take their syntax tokens                                                                                                            | `editor-highlighting.png`    |
| 2   | Caret in statement 2, ⌘↵: only statement 2 runs and flashes                                   | postgres | Pass. The flash covers exactly the `UPDATE`; Output has one entry, `1 row affected in … ms`, and no result tab opens; the flash clears after 900 ms                                                 | `run-at-caret.png`           |
| 3   | Select all three, ⌘↵: Output plus `Result 1` and `Result 2`                                   | postgres | Pass. Output logs `2 rows retrieved`, `1 row affected`, `1 row retrieved`; tabs are `Output`, `Result 1`, `Result 2` with `Result 2` active, and `Result 1`'s tooltip is `SELECT * FROM customers`  | `run-selection.png`          |
| 4   | Statement 2 fails: Output shows the error, statement 3 skipped                                | mysql    | Pass. Output shows the first statement's rows, MySQL's `no_such_table` error, then `1 statement skipped after the error.`; `Output` is the active tab and only `Result 1` exists                    | `batch-stops-on-error.png`   |
| 5   | `DELETE FROM orders` without `WHERE`: confirm lists it; Cancel; row count unchanged           | mysql    | Pass. `Run a destructive statement?` lists `DELETE FROM orders` with `DELETE without WHERE`; Cancel logs `Cancelled; nothing ran.` and the count is unchanged                                       | `destructive-confirm.png`    |
| 6   | Tx Manual, `INSERT`, badge on, Rollback, row gone                                             | postgres | Pass. The badge shows after the `INSERT` and clears on Rollback; a `SELECT count(*)` for order 9001 returns 0                                                                                       | `manual-rollback.png`        |
| 7   | Tx Manual, `INSERT`, Commit, row visible from a second console                                | mysql    | Pass. A second console on the same datasource sees 0 rows before Commit and 1 after                                                                                                                 | `manual-commit.png`          |
| 8   | Close a console with an open transaction: Commit / Rollback / Cancel                          | sqlite   | Pass. ⌘W asks `Open transaction` with Cancel, Commit and Rollback; Cancel keeps the tab and the badge; ⌘W then Rollback closes it                                                                   | `close-open-transaction.png` |
| 9   | Type, relaunch: tab and text restored, datasource not connected until Run                     | sqlite   | Pass. `consoles/local/console.sql` holds the text; after relaunch the tab `console [local]` shows it, the tree node is disconnected and no engine runs; Run All connects and returns both customers | `autosave-restored.png`      |
| 10  | `CREATE FUNCTION … $$ … $$` runs as one statement                                             | postgres | Pass. Two Output entries, the `CREATE FUNCTION` and the `SELECT` calling it, and the grid shows 5                                                                                                   | `dollar-quoted.png`          |
| 11  | `CREATE TABLE` in auto mode: the table appears in the tree without Synchronize                | postgres | Pass. `console_smoke_new` appears under `public` and the group reads `tables 4`; Output says `completed in … ms`                                                                                    | `ddl-refreshes-tree.png`     |
| 12  | Drag `orders` from the tree into the editor                                                   | postgres | Pass. Dropping after `SELECT * FROM ` inserts `"public"."orders"` at the drop point                                                                                                                 | `drag-qualified-name.png`    |
| 13  | Pin `Result 1`, run again: pinned tab stays, others replaced                                  | sqlite   | Pass. After the second run the tabs are still `Output`, `Result 1` (pinned, old rows) and `Result 2` (new rows)                                                                                     | `pinned-result.png`          |
| 14  | Esc closes speed search in the tree and completion in the editor; ⌘- still collapses the tree | postgres | Pass. Esc closes the tree's speed search; in the editor `SEL` opens completion and Esc closes it with focus and text kept; ⌘- in the tree collapses it                                              | `keys-coexist.png`           |

Bugs found here are fixed with a regression test and listed under Deviations.

---

## Deviations taken while implementing

1. **Closing the window waits for the renderer (decision 024).** Decision 15 needs the quit prompt,
   and only the renderer knows which consoles hold open transactions and unsaved text. Main holds
   every window close behind `main/closeGuard.ts` and two channels the plan did not list,
   `window.close-requested` and `window.answer-close`; `beforeunload` cannot wait for a dialog.
2. **plugin-api/sql has two additions beyond decision 023.** `SqlDialectOptions.hashComments` covers
   MySQL's `#` comments; without it a `;` inside one split the statement in the middle of the
   comment. `transactionEffect(sql, options)` answers `begin`, `end` or `null`: `classify`'s
   `transaction` kind cannot tell `BEGIN` from `COMMIT`, and every plugin needs that to track `open`
   in auto mode. Both are public API under `0.5.0`.
3. **`BEGIN … END` bodies open only inside `CREATE TRIGGER`, `FUNCTION`, `PROCEDURE` or `EVENT`.**
   `BEGIN;` starts a transaction on PostgreSQL and SQLite, and a column may be named `begin`;
   treating every `BEGIN` as a block swallowed the rest of the script. Inside a body, `END IF`,
   `END LOOP`, `END WHILE`, `END REPEAT` and `END CASE` do not close it.
4. **A plugin declaring `sql` without `language` is unavailable.** The loader reports it the way it
   reports a missing capability, rather than letting the first Run fail. core now exports
   `loadedPlugin`, which the engine uses for `script.split` as well as `session.open`.
5. **`setMode("auto")` refuses while a transaction is open.** The plugin rejects with
   `statementFailed` and stays in manual; the renderer asks Commit, Rollback or Cancel first
   (decision 13), so the plugin never commits on the user's behalf. On MySQL a DDL statement ends
   the transaction (implicit commit) and `open` follows it.
6. **In manual mode every statement opens the transaction, a `SELECT` included.** The plugin sends
   `BEGIN` before the first statement whatever its kind, as DataGrip does, so the badge appears after
   a plain read on PostgreSQL and SQLite. Live test 6 rolls back twice for this reason.
7. **`PluginInfo` carries `highlight`.** The renderer cannot read manifests (decision 002), and the
   editor needs the dialect name; `plugins.list` now returns it, or `null` for an unavailable plugin.
8. **The modal gains a `choice` kind and item lists.** The destructive confirm lists each statement
   with its reason, and the open-transaction prompt has three answers; both reuse plan 004's modal.
9. **The editor-chord fence works by focus, and a shortcut can name several regions.** The registry
   skips `EDITOR_CHORDS` only while focus is inside `.cm-editor` (`KeymapOptions.reservedChords`), so
   `Mod+D` (Duplicate datasource) and `Escape` still work in the Database pane. `shortcutRegion`
   accepts a list, and `focus.editor` (Escape) is limited to the Database and Services panes; the
   keymap test checks reserved chords against every action that can fire in the editor.
10. **The transaction mode control is a native `<select>`.** It reads `Tx: Auto` / `Tx: Manual` and is
    keyboard- and screen-reader-accessible for free; a custom menu button can come with plan 013's
    toolbar work.
11. **New consoles start empty.** `INITIAL_SQL` is gone; a placeholder says `⌘↩ runs the statement
at the caret`. Consoles on the environment's ephemeral datasource (decision 018) are not
    autosaved, because nothing ties their files to a datasource that survives the launch.
12. **Statement errors also show in the toolbar.** Output logs every error, but the toolbar's alert
    stays, including `The statement was cancelled.`, so a user looking at a result tab sees that the
    batch stopped. The first version dropped it for cancels and broke plan 003's cancel smoke test.
13. **DDL logs `completed in N ms`.** The screenshot of live test 11 showed `0 rows affected` for a
    `CREATE TABLE`, which drivers report as zero. Only `write` statements print rows affected
    (`givenDdlWithDriversZeroAffected_whenFormatted_thenCompletedNotZeroRows`).
14. **Toolbar and tab strip layout fixes.** The screenshot of live test 4 showed `Run All` wrapping to
    two lines beside a long error; toolbar buttons no longer shrink or wrap. The result tab strip
    showed a stray vertical scrollbar, 1 px of tab height over the strip; tabs now fill it exactly.
15. **The open-transaction prompt reads as a sentence.** It said `Close: these consoles have
uncommitted changes.` for one console; it now says `This console has uncommitted changes. Commit
or roll back to close.`, with `disconnect`, `quit` and `switch to Auto` as the other verbs.
16. **Completion shows no icons.** CodeMirror's default type icons rendered as emoji-like glyphs in
    the screenshot of live test 14; keyword-only completion gains nothing from them.
17. **Smoke suites run one file at a time.** `test:smoke` and `test:smoke:db` pass
    `--no-file-parallelism`: the console suite's `CREATE TABLE` and the explorer suite's ran against
    the same Postgres at once and broke each other's `tables 3`. Plan 005's Synchronize test now
    creates its table outside the app, since a console `CREATE TABLE` refreshes the tree by itself.
18. **The smoke harness runs whole scripts with Run All.** `startStatement` fills the editor and
    clicks `Run All`, as the plan's consequence allowed; tests that meant the caret use ⌘↵ directly.

---

## Out of scope

- Schema-aware completion, alias resolution, go to declaration: plan 009.
- Query history: plan 011. Output is per console and in memory only.
- The Services window's session tree, and choosing a session per console: plan 011.
- Statement chooser popup, run with parameters, execute to file: later.
- Reformat (⌘⌥L) and live templates: later.
- Isolation level and per-datasource default transaction mode: the Advanced tab, later.
- Grid paging, sorting and extractors on result tabs: plan 007.
- Opening console files closed earlier from a list: plan 011, with history.
