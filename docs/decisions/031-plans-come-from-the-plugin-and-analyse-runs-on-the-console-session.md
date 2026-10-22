# 031: Plans come from the plugin as one tree, and Explain Analyse runs on the console's session

Status: Accepted

## Decision

A plugin that declares `explain` gives its `Session` an `explain(sql, { analyze })` method that
builds the dialect's EXPLAIN statement, runs it on that session and returns the plan as one
normalised tree of `PlanNode`s (operation, target, estimates, actuals, the rest as named
properties) together with the raw text the database printed. Its `SqlLanguage` gains
`explainable(sql, { analyze })`, a pure check that says whether the statement can be explained
that way and whether doing so writes, or why not. `explainAnalyze` is a separate capability for
plugins whose database can execute a statement and report what happened (PostgreSQL, MySQL; not
SQLite).

Explain Analyse runs on the console's own session, through the same path as Run: it holds the
session, closes the open cursor, reports `transactionOpen`, and can be cancelled. It is never run
on a side session. Before a statement that writes is analysed, the console asks, saying that the
statement will run and whether its changes will be committed (auto-commit) or stay in the open
transaction (manual).

The shared classifier treats `EXPLAIN ANALYZE <statement>` as the statement it runs: its kind and
its destructive reason come from the inner statement. Plain `EXPLAIN` stays a `read` and is never
destructive.

## Rationale

The plan formats differ completely: PostgreSQL prints JSON, MySQL a text tree (`FORMAT=TREE`, the
only format `EXPLAIN ANALYZE` accepts), SQLite rows linked by `parent`. Reading any of them is SQL
knowledge, which belongs to the plugin (decision 008); a renderer that parsed three formats would
also break the UI-branches-on-capabilities rule (decision 007) the first time a fourth plugin
arrived. One normalised tree lets one view draw every database, and the raw text keeps whatever the
tree leaves out.

Running Analyse anywhere but the console's session would be wrong in a way users cannot see: on a
side session an `EXPLAIN ANALYZE DELETE` typed in a manual-mode console would autocommit outside
the transaction the console's Rollback button promises to undo. Wrapping it in a hidden
`BEGIN … ROLLBACK` would quietly change what the statement means and cannot nest inside an open
transaction; asking first, and saying where the changes go, keeps the console honest.

The classifier fix closes a hole that already exists: `EXPLAIN ANALYZE DELETE FROM orders`, run
with Run, classified as a plain `read` and skipped the destructive-statement confirmation
(decision 011).

## Consequences

- API version 0.10.0; `explain` and `explainAnalyze` join `CAPABILITIES`, `explainAnalyze` requires
  `explain`, and both need contract coverage (decision 013).
- MySQL analyses only `SELECT` (`EXPLAIN ANALYZE` accepts nothing else); `explainable` refuses the
  rest with a reason before anything is asked or run.
- An analysed write in an auto-commit console is committed. That is what the user confirmed, and
  the plan says so above the tree.
- A statement the user types as `EXPLAIN …` and runs with Run still shows as rows in the grid;
  only Explain Plan and Explain Analyse draw the tree.
- `PlanNode` estimates and actuals are numbers, not database wire values (decision 017 governs row
  values, not plan metadata); anything a plugin cannot map lands in `properties` as text.
