# 056: A console result is editable when it provably reads one table

Status: Proposed. Amends 026.

## Decision

A console result takes edits only when three sources agree that it reads one base table and shows
its key:

1. The plugin's `SqlLanguage.selectSource` (plugin API 0.18.0) reads the statement. The shared
   `sqlCompleter` implements it with a strict token parser: `SELECT [ALL] items FROM table [[AS]
alias]`, then only `WHERE`, `ORDER BY`, `LIMIT`, `OFFSET` and `FETCH` at the top level. Joins,
   `DISTINCT`, `GROUP BY`, `HAVING`, window functions, aggregates, set operations, `WITH`, `INTO`,
   `FOR` and subqueries or functions in `FROM` answer `readOnly` with the reason. Each select item
   maps to a table column, `*` expands from the catalog, anything else is an expression (`null`).
2. The engine's catalog cache names the relation's kind and key: a view, a materialized view or a
   table without a primary key or unique `NOT NULL` key is read-only, as in the table editor.
3. The driver's `Column.origin`, where it reports one (PostgreSQL `tableID`/`columnID`, MySQL
   `orgTable`/`orgName`, SQLite's column metadata), must agree: a column the parser calls plain
   but the driver calls computed, or columns from two tables, make the result read-only.

Expression columns and repeated columns in an editable result are read-only one by one. The key
columns must appear as plain columns. Edits reuse core's `generateEdits` and the table editor's
renderer buffer; there is no second edit path.

Edits run on the console's own session (`edits.submit` with the console's session id) and follow
its transaction mode. In auto mode they run in one transaction and commit, as in the table editor.
In manual mode they join the console's transaction under the savepoint `table_craft_edits`
(`SqlLanguage.savepoint`); a rejected edit rolls back to it, so earlier work in the transaction
survives, and nothing commits until the user does. A plugin without `savepoint` may submit in
manual mode only while no transaction is open, and then rolls the whole transaction back on
failure.

## Rationale

DataGrip edits any result it can trace to a table. Guessing wrong writes to rows the user did not
mean, so the rule is "provably safe or read-only": a parse alone misses a view or a computed
column a driver reports, and driver metadata alone misses `DISTINCT` and aggregates (PostgreSQL
reports a table for `SELECT DISTINCT id`). SQL knowledge stays in the plugin (decision 008); the
engine only joins answers.

A separate session per edit, like the table editor's, would not see the console's uncommitted
rows and could deadlock on its locks. The console's session is the one the user is thinking in.
The savepoint keeps "a rejected submit changes nothing" true inside an open transaction.

## Consequences

- Plugin API 0.18.0: `Column.origin`, `SqlLanguage.selectSource` and `SqlLanguage.savepoint`, all
  optional; a plugin without `selectSource` keeps console results read-only.
- A console result can hold pending edits, so Run, Rerun, Explain, sort, closing and quitting ask
  Submit, Discard or Cancel first. With a local sort on, fetching more or changing the local filter
  re-numbers held rows and asks too.
- After a submit the console re-runs the statement in place; a statement with parameters asks
  for them again.
- Not covered: views, multi-table results, stored procedures, results of a `SELECT` written with
  a table function or a CTE. They stay read-only with the reason in the toolbar.
