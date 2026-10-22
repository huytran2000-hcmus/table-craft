# Plan: Explain Plan and Explain Analyse

Status: done. A console explains the statement at the caret: Explain Plan (⇧⌘E, or the toolbar
icon after Run All) asks the plugin whether it can, sends the dialect's EXPLAIN on the console's
session without running the statement, and opens a `Plan` tab: a tree-table of operations with
estimated rows and cost, a bar showing each node's share of the root's cost, the selected node's
detail and properties in a strip beside it, the plan's summary above, and a Raw view of what the
database printed, with Copy. Explain Analyse (no chord, a warning-toned icon) runs the statement
and opens `Plan (analysed)` with actual rows, time and loops under a banner saying it ran; for a
write it first asks, in a destructive dialog, saying whether the changes will be committed or stay
in the open transaction. Both are new capabilities (`explain`, `explainAnalyze`, API 0.10.0):
PostgreSQL reads `EXPLAIN (FORMAT JSON)`, MySQL `FORMAT=TREE` (and `FORMAT=JSON` for a single-table
`UPDATE`/`DELETE`, the only form 8.4 explains), SQLite `EXPLAIN QUERY PLAN`; SQLite has no Analyse,
and its console shows neither the button nor the palette entry. A statement the dialect cannot
explain, several statements, or an `EXPLAIN …` already is refused in Output with the plugin's
reason, and MySQL refuses to analyse anything but `SELECT`/`TABLE`. The classifier closes the hole
the plan opened with: `EXPLAIN ANALYZE DELETE FROM orders` run with Run now asks for destructive
confirmation, while a plain `EXPLAIN` stays a harmless read. History records the EXPLAIN text sent,
and Services lists `Explain: …` / `Explain Analyse: …`. Readers are unit-tested on real outputs
captured from PostgreSQL 17, MySQL 8.4.11 and SQLite 3.51 (`test/support/plans/`).

## The issue

Decision 014 ships an "EXPLAIN plan view" (`docs/decisions/014-what-v1-ships.md:24`), and the
specification promises EXPLAIN (`docs/design/specification.md:11`). Today a user can only type
`EXPLAIN …` and run it: PostgreSQL answers one JSON cell, MySQL one text cell, SQLite a few rows of
`id, parent, detail`, and the grid shows each as it would any other value. Nothing reads a plan,
nothing draws a tree, and nothing tells a user that one of these runs the statement.

That last part is already a hole. `classifyTokens` (`packages/plugin-api/src/sql/classify.ts:82-93`)
maps `EXPLAIN` to `read` (`:5`) and looks for a destructive reason only on the first verb, so
`EXPLAIN ANALYZE DELETE FROM orders` is a harmless read: Run skips the destructive-statement
confirmation (`renderer/state/consoles.ts:573`) and deletes every row. `DESTRUCTIVE_CASES`
(`packages/plugin-api/src/testing/index.ts:82-91`) has no EXPLAIN row.

Decisions 007 (`:7`) and 013 (`:9`) name `explain` as a capability with contract coverage, but
`CAPABILITIES` is `sql, cancel, schemaTree, transactions, ddl` (`plugin-api/src/plugin.ts:16`).

DataGrip's model (`docs/design/datagrip-inventory.md:356,374-380`, workflow 18 at `:1086`): Explain
Plan shows the optimiser's plan without running the statement; Explain Analyse runs it and shows
runtime statistics, and "the clone should clearly distinguish these actions, especially for
statements that change data".

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Two capabilities, `explain` and `explainAnalyze`; the manifest refuses `explainAnalyze` without `explain` and `explain` without `sql` (as `ddl` requires `schemaTree`, `manifest.ts:62-66`). API 0.10.0. PostgreSQL and MySQL declare both, SQLite `explain` only (decision 031)                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2   | `SqlLanguage.explainable(sql, { analyze }): Explainability`, pure: `{ ok: true, writes }` or `{ ok: false, reason }`. Refused: empty input, more than one statement, a statement already starting with `EXPLAIN`/`DESCRIBE`/`DESC`, and kinds the dialect cannot explain (DDL other than `CREATE TABLE … AS`, transaction control, `SET`, `SHOW`); MySQL refuses Analyse of anything but `SELECT`/`TABLE`/`WITH … SELECT`. `writes` is the inner statement's kind not being `read`                                                                                                                                                                                                                                                                        |
| 3   | `Session.explain?(sql, { analyze }): Promise<ExplainedPlan>`, present exactly when `explain` is declared: it checks `explainable` (typed `PluginError` code `explainUnsupported`, with the reason), builds the dialect's statement, runs it on this session, reads every row and returns the tree. It holds the session like `execute`, so `cancel` works while Analyse runs                                                                                                                                                                                                                                                                                                                                                                              |
| 4   | Dialect statements: PostgreSQL `EXPLAIN (FORMAT JSON) …` and `EXPLAIN (ANALYZE, FORMAT JSON) …`; MySQL `EXPLAIN FORMAT=TREE …` and `EXPLAIN ANALYZE FORMAT=TREE …` (if mysql:8.4 rejects `FORMAT=TREE` for a DML kind, use `FORMAT=JSON` for that kind and record it as a deviation); SQLite `EXPLAIN QUERY PLAN …`                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 5   | `PlanNode` (plugin-api `explain.ts`): `{ operation, target: string \| null, detail: string \| null, estimatedRows, estimatedCost, actualRows, actualTimeMs, loops, properties: { name, value }[], children }`, numbers or null. `ExplainedPlan`: `{ statement (the EXPLAIN text sent), analyzed, roots: PlanNode[], summary: { name, value }[] (e.g. Planning Time, Execution Time), raw: string }`. PostgreSQL's `Node Type`/`Relation Name`/`Alias`/`Index Name`/`Total Cost`/`Plan Rows`/`Actual Total Time`/`Actual Rows`/`Actual Loops` map to fields, every other key to `properties`; MySQL's `-> op  (cost=… rows=…) (actual time=a..b rows=n loops=m)` lines nest by indent; SQLite builds the tree from `parent` with `detail` as the operation |
| 6   | Engine calls `sql.explainable { sql, analyze } → Explainability` (language only, like `sql.generate`) and `statement.explain { sessionId, sql, analyze } → { plan, transactionOpen }`, which goes through `sessionFor` and closes the open cursor first as `runStatement` does (`engine/engine.ts:533-560`). New `EngineErrorCode` `explainUnsupported`                                                                                                                                                                                                                                                                                                                                                                                                   |
| 7   | `classifyTokens` reads `EXPLAIN [ANALYZE \| ANALYSE] [VERBOSE] [( … )] [FORMAT = x] <statement>`: with `ANALYZE` (bare, or `ANALYZE` / `ANALYZE TRUE` / `ANALYZE ON` inside the parenthesised options) the kind and destructive reason are the inner statement's, the reason prefixed `EXPLAIN ANALYZE runs it: `; without it, `read` and never destructive. `ANALYZE FALSE`/`OFF` is not analyse                                                                                                                                                                                                                                                                                                                                                         |
| 8   | Actions `console.explain` "Explain Plan" (⇧⌘E, tab kind `console`, `when` the datasource has `explain`) and `console.explainAnalyze` "Explain Analyse" (no chord, deliberately; `when` it has `explainAnalyze`). Both take the statement at the caret or the selection, resolved like Run (`model/statementAt.ts`); a selection holding several statements is refused in Output: "Explain one statement at a time." Both are toolbar buttons after Run All and palette entries; Explain Analyse is styled as a warning action                                                                                                                                                                                                                             |
| 9   | Flow: `script.split` → `sql.explainable`; refused → an Output warning with the reason, nothing runs. Analyse with `writes` → `useModal` confirm, destructive styling: title "Explain Analyse runs this statement", message names the statement's first line and, by transaction mode, "Its changes will be committed." (auto) or "Its changes stay in the open transaction until you commit or roll back." (manual), plus the destructive reason if any; button "Run and Explain". Declined → nothing runs or is recorded. Explain Plan and Analyse of a read never ask                                                                                                                                                                                   |
| 10  | A console's result tabs become `ResultTab \| PlanTab`, discriminated by `kind: "rows" \| "plan"`. A plan tab is titled `Plan` or `Plan (analysed)`, holds `{ sql, analyzed, plan }`, pins and is replaced like a result tab, and its rerun explains again with the same mode (asking again when analyse writes). Output logs `Explained in N ms` / `Analysed in N ms`                                                                                                                                                                                                                                                                                                                                                                                     |
| 11  | `console/PlanView.tsx`: a tree-table (`role="treegrid"`), nodes expanded, the Services/Database keyboard model. Columns Operation (indented, caret, operation + target), Rows (est.), Cost (est.), and when analysed Actual Rows, Time, Loops; empty cells for nulls; a thin `bg-plan-bar` bar in the Cost (or, analysed, Time) cell at the node's share of the root's. A details strip on the right lists the selected node's `detail` and `properties`, and the plan's `summary` above the tree                                                                                                                                                                                                                                                         |
| 12  | An analysed plan opens with a warning-tone banner, "Explain Analyse ran this statement." and, when it writes, "Its changes were committed." or "Its changes are in the open transaction." A segmented Tree / Raw toggle shows `raw` in a read-only CodeMirror view; Copy copies `raw`                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 13  | History records the EXPLAIN text actually sent (`ExplainedPlan.statement`), as a console statement, with its outcome and duration; Services shows it as an execution labelled `Explain: <first line>` or `Explain Analyse: <first line>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 14  | Running `EXPLAIN …` typed by hand with Run is unchanged: rows in the grid. Only the classifier change (decision 7) affects it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### Consequences worth naming

**The plugin contract changes.** API 0.10.0, two capabilities, `SqlLanguage.explainable`,
`Session.explain`, `PlanNode`/`ExplainedPlan`, the `explainUnsupported` error code, and two contract
blocks. Every manifest's `apiVersion` moves.

**This is a behaviour change.** `EXPLAIN ANALYZE DELETE …` without `WHERE`, run with Run, now asks
first. Result tabs gain a second kind.

**This default was chosen without asking.** Explain Analyse has no chord; a read is analysed without
asking; an analysed write in auto-commit is committed rather than rolled back; MySQL analyses
`SELECT` only; the plan tab replaces unpinned result tabs like any run.

**The renderer still parses no SQL** (decision 008): the check, the statement text and the tree all
come from the plugin through the engine.

---

## Phase 0 — the contract

| File                              | Responsibility                                                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `plugin-api/src/explain.ts`       | `PlanNode`, `ExplainedPlan`, `Explainability`, `ExplainOptions`                                                             |
| `plugin-api/src/plugin.ts`        | `explain`, `explainAnalyze` in `CAPABILITIES`; `SqlLanguage.explainable`; `Session.explain`                                 |
| `plugin-api/src/manifest.ts`      | the two refines (decision 1)                                                                                                |
| `plugin-api/src/errors.ts`        | `explainUnsupported`                                                                                                        |
| `plugin-api/src/version.ts`       | `0.10.0`                                                                                                                    |
| `plugin-api/src/sql/classify.ts`  | decision 7                                                                                                                  |
| `plugin-api/src/sql/explain.ts`   | shared helpers plugins may use: the option-skipping reader of decision 7, the single-statement and already-EXPLAIN refusals |
| `plugin-api/src/testing/index.ts` | `DESTRUCTIVE_CASES` rows; `explain` and `explainAnalyze` blocks                                                             |

## Phase 1 — the plugins

- `plugins/postgres/src/explain.ts`: the statements of decision 4, the JSON reader of decision 5.
- `plugins/mysql/src/explain.ts`: the TREE reader (indent → depth, `cost=`, `rows=`, `actual time=`,
  `loops=`), the Analyse refusal.
- `plugins/sqlite/src/explain.ts`: `EXPLAIN QUERY PLAN` rows → tree.
- Each `index.ts` and `table-craft-plugin.json`: capabilities and `apiVersion`.

## Phase 2 — the engine

- `engine/protocol.ts`: `sql.explainable`, `statement.explain`, the error code, the capability mirror
  (`:43`); `engine/requests.ts`: their schemas; `engine/engine.ts`: the routes (decision 6).

## Phase 3 — the console

- `state/resultTab.ts` and `state/consoles.ts`: the `kind` union, `explain(id, analyze)` and the
  flow of decision 9, rerun of a plan tab, history and executions (decision 13).
- `console/PlanView.tsx`, `console/ResultTabs.tsx` (plan tabs), `console/Console.tsx` (toolbar).
- `actions/appActions.ts` (or a new `actions/explainActions.ts`): decision 8, icons in
  `actions/registry.ts` and `ui/icons.ts`; `test/renderer/keymap.test.ts` stays green (⇧⌘E is free
  today).
- Design tokens for the plan bar, the analysed banner and the tree-table in
  `docs/design/design-system.md`.

## Phase 4 — Fixtures, tests, docs

No fixture schema change; `orders` (3 rows, index on `placed_at`) and `customers` carry every case.

Contract (each dialect): `givenSelect_whenExplained_thenTreeWithAnOperation`,
`givenDeleteWithoutWhere_whenExplained_thenNothingRuns` (`orders` still has three rows),
`givenDdl_whenExplainable_thenRefusedWithReason`,
`givenTwoStatements_whenExplainable_thenRefused`, `givenExplainStatement_whenExplainable_thenRefused`,
`givenSelect_whenAnalysed_thenActualRowsPresent` (analyse block),
`givenUpdateInManualTransaction_whenAnalysed_thenRolledBackLeavesRows` (analyse and transactions),
`givenMysqlDelete_whenAnalyseExplainable_thenRefused` (fixture flag).

Classifier: `givenExplainAnalyzeDeleteWithoutWhere_whenClassified_thenDestructive`,
`givenExplainDeleteWithoutWhere_whenClassified_thenReadNotDestructive`,
`givenExplainParenthesisedAnalyze_whenClassified_thenInnerKind`,
`givenExplainAnalyzeFalse_whenClassified_thenRead`.

Readers (unit, on captured outputs under `test/support/plans/`):
`givenPostgresJson_whenRead_thenNestedNodesAndSummary`, `givenMysqlTree_whenRead_thenDepthFromIndent`,
`givenSqliteRows_whenRead_thenTreeFromParent`.

Renderer: `givenAnalyseOfWrite_whenRun_thenAsksWithTransactionWording`,
`givenRefusedStatement_whenExplained_thenOutputWarningAndNothingRuns`,
`givenSeveralStatementsSelected_whenExplained_thenRefused`,
`givenPlanTab_whenRerun_thenSameMode`, `givenPlanRows_whenBuildingTree_thenBarShareOfRoot`.

Docs: specification gains an "Explain" section (capabilities, the check, the two requests, the flow,
the plan tab), the capability table rows, the engine request rows and the actions; decision 011's
destructive list gains the EXPLAIN ANALYZE rule by reference to 031; design-system gains the plan
view.

Every phase ends with `bun run typecheck` and `bun run test` both green; Phases 0–2 also
`bun run test:db`.

---

## Live test

Run with `TABLE_CRAFT_EVIDENCE_DIR=docs/evidence/012 bun run test:smoke:db`, suite
`test/e2e/explain.smoke.test.ts`, 1200×800.

| #   | Scenario                                                                                                         | Database | Result                                                                                                                                                                                                                                         | Evidence                   |
| --- | ---------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 1   | ⇧⌘E on a join of `orders` and `customers` opens a `Plan` tab: a tree with operations, estimated rows and cost    | pg       | Pass. `Plan` beside Output: Nested Loop over Seq Scan `orders o` and Index Scan `customers c`, Rows (est.) 2/2/1, Cost (est.) 17.39/1.04/8.17 with share bars; the root's properties on the right; Output `Explained in N ms`                  | `plan-pg.png`              |
| 2   | The same on mysql: a tree read from `FORMAT=TREE`                                                                | mysql    | Pass. Nested loop inner join › Filter › Table scan on o, and the index lookup on c, by indent; cost 0.9/0.55/0.55/0.35, rows 1/1/3/1; Raw starts `-> Nested loop inner join`; the numbers stay in view beside a long operation (deviation 13)  | `plan-mysql.png`           |
| 3   | The same on sqlite: a tree from `EXPLAIN QUERY PLAN`, no cost columns filled                                     | sqlite   | Pass. `SCAN o` and `SEARCH c USING INTEGER PRIMARY KEY (rowid=?)`; Rows (est.) and Cost (est.) empty                                                                                                                                           | `plan-sqlite.png`          |
| 4   | Selecting a node shows its filter or index condition and other properties in the details strip                   | pg       | Pass. Seq Scan `orders o` selected; the strip lists Parent Relationship, Parallel Aware, Async Capable, Startup Cost, Plan Width and Filter `(total > '10'::numeric)`                                                                          | `plan-details.png`         |
| 5   | Raw shows the JSON PostgreSQL printed; Copy puts it on the clipboard                                             | pg       | Pass. Raw pressed, the pretty-printed JSON from `[` / `"Plan"` / `"Node Type": "Nested Loop"`; the clipboard parses as that JSON and starts with the lines shown                                                                               | `plan-raw.png`             |
| 6   | Explain Analyse of a `SELECT`: no question, `Plan (analysed)` with actual rows, time, loops and the banner       | pg       | Pass. No dialog; `Plan (analysed)` with Actual Rows 2/2/1, Time (ms) and Loops 1/1/2, the bar under Time, the banner `Explain Analyse ran this statement.` and `Planning Time … · Execution Time …`; Output `Analysed in N ms`                 | `analyse-select.png`       |
| 7   | Explain Analyse of `UPDATE orders SET total = total WHERE id = 1` in auto mode asks, saying it will be committed | pg       | Pass. `Explain Analyse runs this statement`, `Its changes will be committed.`, the statement, Cancel and a red `Run and Explain`; Cancel logs `Cancelled; nothing ran.` and opens no tab                                                       | `analyse-confirm-auto.png` |
| 8   | In manual mode, confirmed: plan shown, transaction open, Rollback leaves `orders` unchanged                      | pg       | Pass. After `Run and Explain`: ModifyTable under `… Its changes are in the open transaction.`, the `transaction open` badge in view (deviation 14); then Rollback, and `total` of order 1 reads 19.99 in the app and outside it (deviation 15) | `analyse-rollback.png`     |
| 9   | Explain Analyse of an `UPDATE` on mysql is refused in Output with the reason; nothing asked or run               | mysql    | Pass. Output warning `MySQL analyses only SELECT or TABLE statements; use Explain Plan for this UPDATE.`; no dialog, no tab, order 1 unchanged                                                                                                 | `analyse-refused.png`      |
| 10  | On sqlite the Explain Analyse button and palette entry are absent                                                | sqlite   | Pass. The toolbar has the Explain Plan icon and no Explain Analyse; Find Action `Explain` lists Explain Plan (⇧⌘E) and Explain Again, not Explain Analyse                                                                                      | `sqlite-no-analyse.png`    |
| 11  | Explain Plan on `CREATE TABLE t (id int)` is refused in Output with the reason                                   | pg       | Pass. Output warning `PostgreSQL cannot explain a CREATE statement. Explain SELECT, VALUES, TABLE, INSERT, UPDATE, DELETE, MERGE or CREATE TABLE … AS instead.`; no table `t` exists                                                           | `explain-refused.png`      |
| 12  | Run on `EXPLAIN ANALYZE DELETE FROM orders` now asks for destructive confirmation; declining deletes nothing     | pg       | Pass. `Run a destructive statement?` lists the statement with `EXPLAIN ANALYZE runs it: DELETE without WHERE`; Cancel logs `Cancelled; nothing ran.`, `orders` still has 3 rows                                                                | `run-analyse-delete.png`   |
| 13  | Services lists the explain as `Explain: SELECT …`; Query History lists the EXPLAIN text sent                     | pg       | Pass. Services: `Explain: SELECT o.id, c.name FROM orders o JOIN …`; Query History: `EXPLAIN (FORMAT JSON) SELECT o.id, …` with its duration and preview                                                                                       | `explain-history.png`      |

Bugs found while testing are fixed with a regression test and listed under Deviations.

---

## Deviations taken while implementing

**1. MySQL explains a single-table `UPDATE` or `DELETE` with `FORMAT=JSON`.** On mysql:8.4.11
`EXPLAIN FORMAT=TREE` and `EXPLAIN ANALYZE` of them print only `-> <not executable by iterator
executor>`, and `EXPLAIN ANALYZE FORMAT=JSON` is error 1235. Decision 4 allowed the switch: the JSON
reader turns `query_block.table` into an `Update`/`Delete` node with the table as target, the access
type and key as detail, and `rows_examined_per_scan` as estimated rows; `Query cost` goes to the
summary. Every other kind uses `FORMAT=TREE`.

**2. MySQL's explainable kinds.** It refuses `CREATE TABLE … AS` (8.4 answers `EXPLAIN` of it with
syntax error 1064) and explains `TABLE`, `VALUES` and `REPLACE` besides `SELECT`, `INSERT`, `UPDATE`
and `DELETE`; it analyses `SELECT` (including `WITH … SELECT`) and `TABLE`, which 8.4 runs.

**3. `DESCRIBE` and `DESC` read like `EXPLAIN`.** MySQL runs `DESC ANALYZE DELETE …`, so the
classifier gives those prefixes the same rule, and the refusal of a statement that is already an
EXPLAIN covers them.

**4. The option reader lives in `sql/words.ts`.** `explainPrefix` (with `words` and `mainVerb`) sits
there rather than in `sql/explain.ts`, because the classifier needs it and `sql/explain.ts` imports
the classifier.

**5. `SqlLanguage.explainable` and `Session.explain` are optional members**, present exactly when
the plugin declares `explain`; a top-level contract case checks both directions.

**6. Plan readers are a plugin subpath.** Each plugin exports `./explain` (package exports,
`tsconfig.json` paths, a Vitest alias) so `test/plugins/planReaders.test.ts` reads the captured
outputs without a database.

**7. Contract shape.** `givenMysqlDelete_whenAnalyseExplainable_thenRefused` lives in
`test/db/mysql.test.ts` rather than behind a fixture flag; the manual-transaction analyse case runs
only where the dialect analyses that `UPDATE`, so it skips on MySQL. The contract also gains
`givenReadAndWrite_whenExplainable_thenWritesOnlyForTheWrite` and
`givenNoExplainAnalyze_whenAnalyseExplainable_thenRefused`, and `DESTRUCTIVE_CASES` three EXPLAIN
rows.

**8. Actions gained `available(context)`.** `when` only greys an action out; Live test row 10 needs
Explain Analyse gone from SQLite's palette, so an action whose plugin lacks the capability is left
out of the palette and cannot run.

**9. The plan tab's commands are actions** (decision 015): `plan.rerun` Explain Again, `plan.copy`
Copy Raw Plan, `plan.showTree` and `plan.showRaw`.

**10. A failed explain records the user's statement in history.** The EXPLAIN text sent arrives only
with the plan, so a failure records what the user asked to explain.

**11. A refused or declined explain sets the console's last outcome to cancelled**, as a declined
destructive Run does, so the Services session row does not claim a success.

**12. `test/support/plans/` is in `.prettierignore`**, so the fixtures stay the byte-exact outputs
the databases printed.

**13. Bug: a long MySQL operation pushed the numbers out of view.** `Single-row index lookup on c
using PRIMARY (id=o.customer_id)` widened the Operation column past the plan pane. The column now
takes the remaining width and truncates, with the whole text as the tooltip; Live test row 2
asserts the Cost column stays inside the tree.

**14. Bug: the new toolbar buttons pushed the console toolbar past the window.** At 1200 px the
datasource name went off the edge, and in manual mode the `transaction open` badge was cut. The two
explain buttons are now icons (title and chord in the tooltip, Explain Analyse still in the warning
tone), and the datasource name truncates; Live test rows 2 and 8 assert both stay in view.

**15. Row 8's evidence is taken before Rollback**, showing the plan, the banner and the open
transaction; what Rollback leaves is asserted in the app (19.99) and outside it. The suite's
teardown kills the app with `SIGKILL` when it will not close, since a graceful quit waits on the
open transaction and its row lock would block the next test's restore.

**16. Summaries.** PostgreSQL's are the top-level keys other than `Plan`, skipping empty arrays
(`Triggers: []`), with ` ms` after `… Time`; MySQL's JSON plans give `Query cost`; TREE plans and
SQLite have none.

---

## Out of scope

- A graphical (box-and-arrow) plan diagram, plan comparison, and saving plans to files.
- Analysing a write and rolling it back automatically; the console's own transaction mode already
  gives that (manual, then Rollback).
- Drawing a tree for an `EXPLAIN …` the user typed and ran with Run.
- `BUFFERS`, `VERBOSE`, `SETTINGS` and other EXPLAIN options; a later preference.
- Explain from the table data editor's WHERE/ORDER BY.
