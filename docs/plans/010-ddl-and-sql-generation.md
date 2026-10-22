# Plan: Show DDL, quick documentation and generated SQL for a relation

Status: done. A relation's definition is one keystroke away: ⌘B on a table or view in the Database
pane, or on its name in a console, opens a read-only, highlighted DDL tab (`orders [pg]`) read from
the database each time through the new `ddl` capability and `Introspector.definition` (API 0.9.0):
MySQL's own `SHOW CREATE`, SQLite's `sqlite_master` text with its indexes and triggers, and a
PostgreSQL definition assembled from the catalog functions with checks, indexes and comments. The
tab refetches after DDL in a console re-describes its namespace, and offers Refresh, Copy and Open
in Console. F1 shows Quick Documentation for a relation or column, in the pane or at the caret, from
the renderer's catalog copy: kind, comment, columns with key marks, primary key, foreign keys out
and in, and indexes. ⌥⌘G opens the SQL Generator: CREATE, DROP, SELECT, INSERT and UPDATE from the
plugin's language over the cached catalog through the shared `sqlGenerator`, previewed and sent to a
console or the clipboard. Generated UPDATEs match no row; generated INSERTs skip identity columns
and run as they are. The relation's context menu carries all three.

## The issue

A relation can be browsed, opened and completed, but its definition cannot be seen. ⌘B on `orders`
in a console reveals the node in the Database pane (`renderer/actions/navigationActions.ts:89-96`),
which shows columns and keys but not the `CHECK`, the view's body, or the statement that would
recreate it. Nothing in the tree reads a definition: no `SHOW CREATE`, `sqlite_master` or
`pg_get_viewdef` appears in any plugin (`plugins/*/src/introspect.ts`). There is no way to see a
table's columns without leaving the editor, and no way to get a `SELECT` with every column, an
`INSERT` skeleton or a `DROP` short of typing it.

Decision 014 ships "DDL view and SQL generator (CREATE, DROP, INSERT, UPDATE, SELECT)" in v1
(`docs/decisions/014-what-v1-ships.md:22`); plans 005 and 009 defer ⌘B into DDL and F1 here
(`docs/plans/005-database-explorer.md:264`, `docs/plans/009-completion-and-navigation.md:44`).
DataGrip's model, from `docs/design/datagrip-inventory.md` §3.2 and §6.2: ⌘B opens the object's
DDL, F1 shows Quick Documentation, and the SQL Generator turns a selected object into a statement
to copy or run.

The driving cases are the fixture's `orders` (foreign key, index, and a new `CHECK`),
`customer_totals` (a view), and `"Line Items"` (quoting), on PostgreSQL, MySQL and SQLite.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Definitions come from the database through a new capability `ddl` and `Introspector.definition(path, name): Promise<string>`, present iff `ddl` (decision 029). `ddl` requires `schemaTree`. All three built-ins declare it                                                                                                                                                                                                                                                                                                                                |
| 2   | Per dialect: MySQL `SHOW CREATE TABLE` / `SHOW CREATE VIEW` verbatim; SQLite `sqlite_master.sql` for the relation, then its explicit indexes' and triggers' `sql`; PostgreSQL assembled from `format_type`, `pg_get_expr`, `pg_get_constraintdef` (contypes p, u, f, c, x), `pg_get_indexdef` for indexes not backing a constraint, `pg_get_viewdef(oid, true)` for views and materialized views, and `COMMENT ON TABLE/COLUMN`. Statements end in `;` and are separated by a blank line                                                                   |
| 3   | An unknown relation raises a typed `DefinitionNotFoundError` (plugin-api errors) naming the path and relation and telling the user to synchronize the datasource                                                                                                                                                                                                                                                                                                                                                                                           |
| 4   | `SqlLanguage` gains `generate(statement, relation, qualifiedName): string` for `statement` = `"drop" \| "select" \| "insert" \| "update"`. `@table-craft/plugin-api/sql` gains `sqlGenerator({ quoteIdentifier, updateDefault })` returning it; the built-ins spread it. `API_VERSION` 0.9.0                                                                                                                                                                                                                                                               |
| 5   | Generated text, one clause per line, columns in table order, names quoted only when needed (the completer's rule): **DROP** `DROP TABLE t;` / `DROP VIEW` / `DROP MATERIALIZED VIEW`, no `CASCADE`. **SELECT** `SELECT c1, c2 FROM t;` unaliased. **INSERT** columns minus `autoIncrement` ones; each value is `updateDefault(default)` when the column has a default, else `NULL`. **UPDATE** `SET` every non-key column `= NULL`, `WHERE` each primary-key column `= NULL` (every column when keyless)                                                   |
| 6   | The generated UPDATE matches no row until edited (`= NULL` is never true) — chosen so a generated statement run by mistake changes nothing. INSERT is the only generated statement that writes as-is                                                                                                                                                                                                                                                                                                                                                       |
| 7   | Engine requests: `catalog.definition { path, name } → string` on the introspection session (decision 022), never cached; `sql.generate { path, name, statement } → string`, where `statement` also takes `"create"`, which answers the definition                                                                                                                                                                                                                                                                                                          |
| 8   | New tab kind `ddl`, one per (datasource, path, relation); reopening focuses it. Title `orders [pg]` with the DDL glyph; body a read-only CodeMirror view (`grid/ValuePanel.tsx:15-22` precedent) with SQL highlighting and a toolbar: Refresh, Copy, Open in Console. It refetches when the renderer's catalog re-describes its namespace (after DDL in a console, decision 028)                                                                                                                                                                           |
| 9   | Action `ddl.open` "Go to DDL": ⌘B in the Database pane on a relation; in the console (`editor.goToDeclaration`, `navigationActions.ts:89-96`) a relation now opens its DDL. A column still reveals its node, and an alias or CTE still jumps. Without `ddl` the relation branch keeps revealing (decision 007)                                                                                                                                                                                                                                             |
| 10  | Action `ddl.openInConsole` opens a new console on the datasource with the text (`openConsole(datasourceId, sql)`, `consoleCommands.ts:35-49`); `ddl.copy` writes the clipboard (`navigator.clipboard`, as `explorerActions.ts:50-52`)                                                                                                                                                                                                                                                                                                                      |
| 11  | Action `catalog.quickDoc` "Quick Documentation", F1, in the Database pane (selected relation or column) and the console (`navigation.resolve` at the caret; relation or column; an alias resolves to its relation). It shows a popover from the renderer's catalog copy (decision 022), no new request: kind, qualified name, comment, columns (name, type, nullable, default, key marks), primary key, foreign keys out and in, indexes; for a column, its type, nullability, default, comment and the keys it is in. Escape or a click outside closes it |
| 12  | The popover is a `ui/Popover.tsx` on `@radix-ui/react-popover` (the app already uses Radix context menu, dialog and tooltip), anchored at the tree row or at the caret's `coordsAtPos`; themed from tokens, max 480×360 px, the columns list scrolls                                                                                                                                                                                                                                                                                                       |
| 13  | Action `sql.generator` "SQL Generator…", ⌘⌥G, Database pane on a relation and the palette: a modal with a segmented control CREATE / DROP / SELECT / INSERT / UPDATE (CREATE hidden without `ddl`, default SELECT), a read-only preview, and Copy and Open in Console. Each switch sends `sql.generate`                                                                                                                                                                                                                                                    |
| 14  | The catalog context menu (`panes/DatabasePane.tsx:81-89`) gains, on relations: Go to DDL ⌘B, Quick Documentation F1, SQL Generator… ⌘⌥G; on columns: Quick Documentation                                                                                                                                                                                                                                                                                                                                                                                   |
| 15  | Fixture: `orders` gets `CHECK (total >= 0)` named `orders_total_nonnegative` in every dialect; `customers` gets the table comment `People who place orders` in PostgreSQL and MySQL (SQLite has no comments)                                                                                                                                                                                                                                                                                                                                               |

### Consequences worth naming

**This changes the plugin contract.** Capability `ddl`, optional `Introspector.definition`,
required `SqlLanguage.generate`, `DefinitionNotFoundError`; `API_VERSION` 0.9.0 and the three
manifests. A third-party plugin gets `generate` by spreading `sqlGenerator`.

**This crosses the fence.** New requests `catalog.definition` and `sql.generate`.

**This is a behaviour change.** ⌘B on a relation in a console opened the Database pane; it now opens
a DDL tab. Select in Database View (`explorerActions.ts:130-135`) stays in the palette.

**This changes fixtures.** A check constraint on `orders` and a comment on `customers`; contract
assertions on `describe` that pin comments change for PostgreSQL and MySQL.

**This default was chosen without asking.** The generated UPDATE's `= NULL` (decision 6) and
INSERT's default-or-NULL values; DROP never cascades.

---

## Phase 0 — contract and generator in plugin-api

| File                             | Responsibility                                                          |
| -------------------------------- | ----------------------------------------------------------------------- |
| `plugin-api/src/plugin.ts`       | `"ddl"` in `CAPABILITIES`; `GeneratedStatement`; `SqlLanguage.generate` |
| `plugin-api/src/catalog.ts`      | `Introspector.definition?`                                              |
| `plugin-api/src/errors.ts`       | `DefinitionNotFoundError`                                               |
| `plugin-api/src/manifest.ts`     | `ddl` in the capability enum; manifests require `schemaTree` with `ddl` |
| `plugin-api/src/sql/generate.ts` | `sqlGenerator(options)`                                                 |
| `plugin-api/src/version.ts`      | `0.9.0`                                                                 |

```ts
export type GeneratedStatement = "drop" | "select" | "insert" | "update";
export function sqlGenerator(options: {
  quoteIdentifier: (name: string) => string;
  updateDefault: (defaultExpression: string) => string;
  plainIdentifier: RegExp;
  keywords: readonly string[];
}): Pick<SqlLanguage, "generate">;
```

Pure units over `Relation` values; no database.

## Phase 1 — plugins and engine

- Each built-in: `definition` in `introspect.ts` per decision 2, `generate` from `sqlGenerator`,
  `ddl` in `CAPABILITIES` (`plugins/*/src/index.ts:38`) and the manifest, `apiVersion` 0.9.0.
- `engine/protocol.ts`, `engine/requests.ts`, `engine/engine.ts`: the two requests.
  `sql.generate` reads the relation through `relationOf` (`engine.ts:303-317`).
- Contract suite: a `ddl` block (`describe.runIf` on the capability, beside `schemaTree` at
  `testing/index.ts:639`) and generator cases in the `language` block. `ContractFixture` gains the
  check's name and the expected `customers` comment.

## Phase 2 — renderer

- `state/tabs.ts:4` gains `"ddl"`; `shell/EditorArea.tsx:61-65,134-138` its glyph and body;
  new `ddl/DdlView.tsx` (read-only editor, toolbar, refetch on re-describe).
- `ui/Popover.tsx`; `catalog/QuickDoc.tsx` rendering a relation or column from the catalog store.
- `dialogs/SqlGenerator.tsx` as a modal kind in `state/modal.ts`.
- `actions/ddlActions.ts`: `ddl.open`, `ddl.copy`, `ddl.openInConsole`, `ddl.refresh`,
  `catalog.quickDoc`, `sql.generator`; `navigationActions.ts` retargets relations.
- `panes/DatabasePane.tsx`: menu items per decision 14.
- Design tokens for the DDL glyph and popover in `docs/design/design-system.md`.

## Phase 3 — Fixtures, tests, docs

Fixture schema, all three seeds (`test/db/schema/{postgres,mysql,sqlite}.sql`): the check on
`orders`; the comment on `customers` in PostgreSQL and MySQL. Update any contract or smoke
assertion that pins `customers.comment`.

New cases:

`givenTable_whenGeneratingSelect_thenListsColumnsInTableOrder`,
`givenNameNeedingQuotes_whenGenerating_thenQuoted`,
`givenAutoIncrementColumn_whenGeneratingInsert_thenOmitted`,
`givenColumnWithDefault_whenGeneratingInsert_thenUsesUpdateDefault`,
`givenPrimaryKey_whenGeneratingUpdate_thenWhereOnKeyColumns`,
`givenKeylessTable_whenGeneratingUpdate_thenWhereOnEveryColumn`,
`givenView_whenGeneratingDrop_thenDropView`,
`givenTable_whenReadingDefinition_thenIncludesColumnsKeysAndCheck`,
`givenTableWithForeignKey_whenReadingDefinition_thenNamesTarget`,
`givenView_whenReadingDefinition_thenIncludesItsQuery`,
`givenUnknownRelation_whenReadingDefinition_thenDefinitionNotFound`,
`givenGeneratedSelect_whenExecuted_thenReturnsTheTablesColumns`,
`givenGeneratedUpdate_whenExecuted_thenAffectsNoRows`,
`givenGeneratedInsert_whenExecutedInTransaction_thenInsertsOneRow`,
`givenPluginWithoutDdl_whenGoingToDeclarationOnRelation_thenReveals`,
`givenOpenDdlTab_whenNamespaceRedescribed_thenRefetches`,
`givenDdlTabOpen_whenOpeningSameRelation_thenFocusesExisting`,
`givenColumnSelected_whenQuickDoc_thenShowsTypeAndKeys`.

Docs: specification gains a "DDL and SQL generation" section (requests, tab, actions, menu) and the
two request rows; the capability list gains `ddl`; design-system gains the DDL glyph and popover
tokens; decision 007's example capability now exists.

Every phase ends with `bun run typecheck` and `bun run test` both green; phases touching plugins
also run `bun run test:db`.

---

## Live test

Run with `TABLE_CRAFT_EVIDENCE_DIR=docs/evidence/010 bun run test:smoke:db`, suite
`test/e2e/ddl.smoke.test.ts`, 1200×800.

| #   | Scenario                                                                               | Database | Result                                                                                                                                                                                                                                                                            | Evidence               |
| --- | -------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1   | ⌘B on `orders` in the Database pane opens its DDL tab with the FK, index and check     | pg       | Pass. Tab `orders [pg]` with the DDL glyph; `CREATE TABLE public.orders (…)` with `orders_pkey`, `orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id)`, `orders_total_nonnegative CHECK (total >= 0::numeric)`, then `CREATE INDEX orders_placed_at_idx`   | pane-go-to-ddl.png     |
| 2   | ⌘B on `orders` in a console opens the same tab (focused, not a second one)             | pg       | Pass. The one `orders [pg]` DDL tab is focused beside `console [pg]`; the strip holds a single DDL tab                                                                                                                                                                            | console-go-to-ddl.png  |
| 3   | DDL of `orders` is MySQL's own `SHOW CREATE TABLE` text                                | mysql    | Pass. Backquoted names, ``KEY `customer_id` ``, ``CONSTRAINT `orders_ibfk_1` ``, ``CHECK ((`total` >= 0))``, `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 …;` as the server prints it                                                                                                   | mysql-show-create.png  |
| 4   | DDL of `customer_totals` shows the view's query                                        | sqlite   | Pass. `CREATE VIEW customer_totals AS SELECT c.id AS customer_id, c.name, COALESCE(SUM(o.total), 0) AS total FROM customers c LEFT JOIN orders o … GROUP BY c.id, c.name;`                                                                                                        | sqlite-view.png        |
| 5   | `ALTER TABLE orders ADD COLUMN note text` in a console refreshes the open DDL tab      | pg       | Pass. After the ALTER runs, the open `orders [pg]` tab shows `note text,` without Refresh; the suite drops the column afterwards                                                                                                                                                  | refetch-after-ddl.png  |
| 6   | Open in Console from a DDL tab opens a console with the text                           | mysql    | Pass. A new `console_1 [mysql]` holds the `SHOW CREATE TABLE` text                                                                                                                                                                                                                | open-in-console.png    |
| 7   | F1 on `customers` in the pane shows comment, columns and the incoming FK from `orders` | pg       | Pass. Popover under the row: Table `table_craft.public.customers`, `People who place orders`, columns `id` (key) / `name` / `email` with types and NOT NULL, primary key, Referenced by `orders_customer_id_fkey: (id) ← orders(customer_id)`, index `customers_email_key` UNIQUE | quick-doc-relation.png |
| 8   | F1 on `o.total` in a console shows the column's type and nullability                   | mysql    | Pass. Popover at the caret: Column `table_craft.orders.total`, Type `decimal(12,2)` NOT NULL                                                                                                                                                                                      | quick-doc-column.png   |
| 9   | SQL Generator on `"Line Items"`: SELECT quoted per dialect                             | all      | Pass. `SELECT id, sku` then `FROM "public"."Line Items";` (pg), ``FROM `table_craft`.`Line Items`;`` (mysql, captured), `FROM "main"."Line Items";` (sqlite); SELECT is checked and focused, CREATE offered                                                                       | generator-select.png   |
| 10  | SQL Generator INSERT on `edit_probe` omits `id` and fills defaults; running it inserts | sqlite   | Pass. `INSERT INTO "main"."edit_probe" (label, qty, note, doc)` / `VALUES ('new', 1, NULL, NULL);` opened in a console; Run All reports 1 row affected                                                                                                                            | generator-insert.png   |
| 11  | SQL Generator UPDATE on `orders` uses `WHERE id = NULL`; running it updates 0 rows     | pg       | Pass. `UPDATE "public"."orders"` / `SET customer_id = NULL, total = NULL, placed_at = NULL` / `WHERE id = NULL;`; Run All reports 0 rows affected                                                                                                                                 | generator-update.png   |
| 12  | Context menu on a relation lists Go to DDL, Quick Documentation, SQL Generator         | mysql    | Pass. Right-click on `orders`: Open Data F4, Go to DDL ⌘B, Quick Documentation F1, SQL Generator… ⌥⌘G, New Console, Synchronize, Copy Qualified Name, Show System Schemas                                                                                                         | context-menu.png       |

Bugs found while testing are fixed with a regression test and listed under Deviations.

---

## Deviations taken while implementing

**1. The relation in a generated statement is the introspector's qualified name.** Decision 5 shows
`SELECT c1, c2 FROM t;`. `generate` receives `qualifiedName`, and the engine passes
`Introspector.qualifiedName(path, name)`, the same text Copy Qualified Name writes: schema-qualified
and always quoted per dialect (`"public"."orders"`, `` `table_craft`.`Line Items` ``,
`"main"."edit_probe"`). An unqualified name would depend on the console's search path, which a
statement opened in a new console does not share. Column names follow the completer's rule (quoted
only when needed), as planned.

**2. Two edge cases in the generator.** A table whose every column is an identity still gets an
INSERT listing every column rather than an empty `()`, and a table that is all primary key still
gets a `SET` (over the key columns) so the UPDATE parses. Both are pinned in
`test/plugin-api/generate.test.ts`.

**3. Generator cases live in a `generate` block of the contract suite, not the `language` block.**
Running the generated SELECT, UPDATE, INSERT and DROP needs `sql` and `schemaTree` both, so the block
is `describe.runIf` on the two. It adds `givenGeneratedDrop_whenExecuted_thenRelationGone`, and the
`ddl` block adds `givenCustomers_whenReadingDefinition_thenIncludesTheTableComment` and a check that
`definition` exists exactly when `ddl` is declared. The manifest schema test adds
`givenDdlWithoutSchemaTree_whenParsed_thenFails`.

**4. The engine names the fix for an unknown relation.** `catalog.definition` on a relation that is
gone fails with the engine error code `definitionNotFound` and the hint "Choose Synchronize (⌥⌘Y) to
see what the namespace holds now.", besides the plugin's own message (decision 3); `sql.generate`
needs `ddl` only for `"create"`, and answers `invalidRequest` for it without the capability.

**5. Quick Documentation describes a namespace on demand.** F1 at a caret can name a relation in a
namespace the Database pane never opened. The catalog store gains `ensureDescribed(datasourceId,
path)`, which describes it without expanding the tree, and the popover reads it when it lands. The
qualified name it shows is the catalog path joined with dots (`table_craft.public.customers`).

**6. One read-only SQL view for both surfaces.** The DDL tab and the generator preview share
`ui/SqlView.tsx` (CodeMirror with line numbers, the console's theme and the plugin's highlight
dialect) instead of each building its own editor; the JSON value panel keeps its own.

**7. DDL tabs are not restored on relaunch.** Consoles and table tabs persist in the layout; a DDL
tab is a view of the database's current text and reopens with one ⌘B, so it is not remembered.

**8. A third density token.** Besides the popover's 480×360 px, the generator dialog's width is
`density.generatorWidthPx` (640 px), wider than the 384 px choice dialogs so a clause fits on a line.

**9. Bug: the SQL Generator focused CREATE while SELECT was checked.** The dialog's only `autoFocus`
was on Open in Console, which is disabled until the first preview arrives, so Radix focused the
first radio. The segmented control is now a roving-tabindex radio group: the checked statement takes
the focus and the tab stop, and the arrow keys move and wrap. Regression:
`givenSelectChosen_whenArrowKeysPressed_thenMovesAndWrapsAcrossStatements` in
`test/renderer/ddl.test.ts`, and the live test's `openGenerator` asserts SELECT has the focus.

**10. An older smoke case moved to a column.** `completion.smoke.test.ts` checked that ⌘B on
`customers` in a MySQL console selects the node; ⌘B on a relation now opens its DDL (the behaviour
change above), so the case is
`givenMysqlCaretOnCustomersEmail_whenGoToDeclaration_thenTheDatabasePaneSelectsIt`, on a column,
which still reveals. No fixture count changed: the check and the comment add no relation.

---

## Out of scope

- Routine, sequence, index and trigger DDL as their own tabs: the tree cannot open them yet
  (decision 029 leaves room).
- Editing DDL in place, Modify Table, Create Table dialogs: not in v1 (plan 008 out of scope).
- Generating for several selected objects at once: the tree selects one node.
- DELETE and MERGE generation: decision 014 names five statements.
- ⌘B on a column opening its relation's DDL at the column's line: the renderer would have to find
  the column in SQL text (decision 008); it keeps revealing the node.
- Schema compare and diffing DDL between datasources: not in v1.
