# Plan: Complete and navigate SQL from the catalog

Status: done. The console completes from the catalog: relations, views, CTEs and namespaces after
FROM and JOIN, columns of an alias, relation, CTE or derived table after `x.`, in-scope columns
(qualified when two sources share a name) in the select list and clauses, the target's columns in
`INSERT INTO t (`, and join items that follow a foreign key either way with an alias and its ON
clause. `sqlCompleter` in `@table-craft/plugin-api/sql` does the scope analysis for every built-in
(API 0.8.0); the engine answers `completion.complete` and `navigation.resolve` from the catalog
cache, describing a namespace on demand within 1.5 s. Names are quoted per dialect, rows carry the
Database pane's glyphs, and the table editor's WHERE and ORDER BY bars complete against their table.
⌘B on an alias or CTE moves the caret to its declaration, on a relation or column reveals it in the
Database pane; F4 opens the relation under the caret. A disconnected console offers keywords and
starts nothing. Completion after `FROM ` over 500 tables appears in 59 ms.

## The issue

The console completes keywords only (`renderer/console/Editor.tsx:127`, CodeMirror's `lang-sql`
keyword source). Typing `SELECT o.` after `FROM orders o` offers nothing, `JOIN` does not suggest
the table a foreign key points at, and ⌘B on a table name does nothing. The engine already holds
everything needed: a described catalog per namespace with columns, keys and foreign keys in both
directions (`core/src/catalog/cache.ts:55`, `described()`), and plugins already quote identifiers
(`SqlLanguage.quoteIdentifier`, `plugin-api/src/plugin.ts:77`).

The driving case is the fixture: `SELECT o.| FROM orders o JOIN |` on PostgreSQL, MySQL and SQLite,
plus the 500-table wide schema from plan 005 for speed.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Completion and resolution run in the engine against the catalog cache (decision 028)                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2   | `SqlLanguage` gains `complete(request, catalog)` and `resolve(request, catalog)`; `API_VERSION` 0.8.0                                                                                                                                                                                                                                                                                                                                                                                            |
| 3   | `@table-craft/plugin-api/sql` gains `sqlCompleter(options)` returning both, built on the plugin's `split` and tokens: `options` = `{ identifierFolding: "lower" \| "upper" \| "none", plainIdentifier: RegExp, keywords, functions }`. The built-ins use it                                                                                                                                                                                                                                      |
| 4   | `CompletionCatalog` (plugin-api): `current` path, `namespaces()`, `relations(path)` async, `relation(path, name)` async, `referencing(path, name)` for incoming foreign keys. The engine implements it over `CatalogCache`, describing on demand with `COMPLETION_DESCRIBE_DEADLINE_MS = 1_500`                                                                                                                                                                                                  |
| 5   | Scope analysis covers the statement at the caret: `FROM`/`JOIN` relations with aliases, comma joins, CTEs (`WITH x AS (…)`, columns from the CTE's select list or its column list), derived tables with aliases, `UPDATE t`, `INSERT INTO t (…)`, `DELETE FROM t`. Unresolvable names are ignored, never errors                                                                                                                                                                                  |
| 6   | Clause contexts and what they offer: after `FROM`/`JOIN`/`UPDATE`/`INTO` → namespaces, relations, CTEs; after `JOIN` additionally join items (decision 7); `x.` → columns of alias/relation/CTE `x`, or relations of namespace `x`; select list, `WHERE`, `ON`, `GROUP BY`, `ORDER BY`, `HAVING`, `SET` → columns in scope (qualified by alias when two in-scope relations share the name), then relations' aliases, functions, keywords; `INSERT INTO t (` → columns of `t`; elsewhere keywords |
| 7   | Join completion, as in DataGrip: after `JOIN`, relations with a foreign key to or from an in-scope relation come first, inserted with an alias and the `ON` clause: `customers c ON c.id = o.customer_id`. Aliases are the initials of the name, de-duplicated with a digit                                                                                                                                                                                                                      |
| 8   | Items: `{ label, kind: "namespace" \| "table" \| "view" \| "column" \| "alias" \| "cte" \| "join" \| "function" \| "keyword", detail, apply, from, to, boost }`. `detail` is the column type or the relation's namespace. `apply` quotes only when the name fails `plainIdentifier` or is a keyword                                                                                                                                                                                              |
| 9   | Request `completion.complete { text, offset, scope? }` → `{ from, to, items, validFor }`. `scope` = `{ path, relation }` for the table editor's WHERE/ORDER BY bars: the text is a clause body with that relation implicitly in scope                                                                                                                                                                                                                                                            |
| 10  | Request `navigation.resolve { text, offset }` → `Declaration` = `{ kind: "alias" \| "cte", from, to }` (in this text) or `{ kind: "relation", path, relation }` or `{ kind: "column", path, relation, column }`, or null                                                                                                                                                                                                                                                                         |
| 11  | Renderer: one CodeMirror completion source per console replacing the keyword-only one while connected; disconnected consoles keep `lang-sql` keywords and send nothing. Requests debounce 0 ms on explicit ⌃Space, 80 ms when typing; a response for an older document version is dropped                                                                                                                                                                                                        |
| 12  | Ranking: the engine orders by context (in-scope columns, join items, then relations, functions, keywords) and `boost`; CodeMirror filters by the typed prefix with its own fuzzy matcher                                                                                                                                                                                                                                                                                                         |
| 13  | Completion icons use the Database pane's node glyphs and tokens; the popup is themed from design tokens                                                                                                                                                                                                                                                                                                                                                                                          |
| 14  | Action `editor.goToDeclaration` ⌘B, scoped to console tabs and the editor region (decision 027): alias/CTE → caret moves to its declaration; relation → reveal in the Database pane and focus it; column → reveal the column node. Plan 010 retargets relation to its DDL                                                                                                                                                                                                                        |
| 15  | Action `editor.openData` F4 on a relation name in the console opens its table tab (`table.open`)                                                                                                                                                                                                                                                                                                                                                                                                 |
| 16  | The WHERE and ORDER BY bars get the same completion with `scope` set to their table                                                                                                                                                                                                                                                                                                                                                                                                              |
| 17  | `Ctrl+Space` joins `EDITOR_CHORDS`; the keymap test still passes                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 18  | Fixture: table `Line Items` (`id` PK, `sku` text) in every dialect, to exercise quoting; PostgreSQL also gets schema `archive` with `old_orders` (`id` PK, `customer_id` FK → `public.customers`) for cross-schema completion                                                                                                                                                                                                                                                                    |
| 19  | Budget: completion over the 500-table wide schema answers in under 100 ms in the engine, asserted in a unit test with a fake catalog and recorded in the live test                                                                                                                                                                                                                                                                                                                               |

### Consequences worth naming

**This changes the plugin contract.** `complete` and `resolve` become required on `SqlLanguage`;
`API_VERSION` 0.8.0. A third-party plugin gets both by calling `sqlCompleter`.

**This crosses the fence.** New requests `completion.complete` and `navigation.resolve`.

**This changes fixtures.** Table counts in older smoke tests change again (`Line Items`, and a
second PostgreSQL schema in the tree when system schemas are hidden).

**This default was chosen without asking.** Join completion inserts an alias and the `ON` clause;
plain relation items insert only the name.

---

## Phase 0 — scope analysis and completion in plugin-api

| File                             | Responsibility                                                                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugin-api/src/completion.ts`   | `CompletionCatalog`, `CompletionRequest`, `CompletionItem`, `CompletionResult`, `Declaration` types                                                |
| `plugin-api/src/sql/scope.ts`    | statement at caret → `{ clause, qualifier, prefixFrom, sources: Source[] }`, `Source` = relation \| cte \| derived with alias and declaration span |
| `plugin-api/src/sql/complete.ts` | `sqlCompleter(options)` → `{ complete, resolve }`                                                                                                  |

```ts
export function sqlCompleter(options: CompleterOptions): Pick<SqlLanguage, "complete" | "resolve">;
```

Pure units, tested with a fake `CompletionCatalog`.

## Phase 1 — plugins and engine

- Each built-in's `language` spreads `sqlCompleter({...})` with its folding (PG lower, MySQL none,
  SQLite none) and keyword/function lists.
- `core/src/catalog/completionCatalog.ts`: `CompletionCatalog` over `CatalogCache` with the deadline.
- `engine/protocol.ts`, `engine/requests.ts`, `engine/engine.ts`: the two requests.
- Contract suite: completion after `FROM`, `alias.`, join item with `ON`, quoting of `Line Items`,
  resolve alias and relation — per dialect.

## Phase 2 — renderer

- `console/completionSource.ts`: CodeMirror source calling the engine, version-checked, item glyphs.
- `Editor.tsx`: swap sources on connect/disconnect.
- `table/FilterBar.tsx`: same source with `scope`.
- `actions/consoleCommands.ts` or a new `actions/navigationActions.ts`: `editor.goToDeclaration`,
  `editor.openData`.

## Phase 3 — Fixtures, tests, docs

Fixture schema: `Line Items` in `test/db/schema/{postgres,mysql,sqlite}.sql`; `archive.old_orders`
in PostgreSQL only. Update older smoke tests' table counts.

New cases:

`givenFromClause_whenCompleting_thenOffersRelationsOfCurrentNamespace`,
`givenAliasDot_whenCompleting_thenOffersColumnsOfAliasedRelation`,
`givenCteDot_whenCompleting_thenOffersCteSelectListColumns`,
`givenDerivedTableAlias_whenCompleting_thenOffersItsColumns`,
`givenNamespaceDot_whenCompleting_thenOffersItsRelations`,
`givenJoinAfterTableWithForeignKey_whenCompleting_thenJoinItemFirstWithOnClause`,
`givenIncomingForeignKey_whenCompletingJoin_thenOffersReferencingTable`,
`givenTwoRelationsShareColumnName_whenCompletingSelectList_thenItemsQualifiedByAlias`,
`givenNameNeedingQuotes_whenCompleting_thenApplyIsQuoted`,
`givenInsertColumnList_whenCompleting_thenOffersTargetColumns`,
`givenUndescribedNamespace_whenCompleting_thenDescribesWithinDeadline`,
`givenDescribeSlowerThanDeadline_whenCompleting_thenAnswersFromCache`,
`givenScopeParam_whenCompletingWhereBar_thenOffersTableColumns`,
`givenAliasReference_whenResolving_thenReturnsDeclarationSpan`,
`givenRelationReference_whenResolving_thenReturnsPathAndRelation`,
`givenUnknownName_whenResolving_thenNull`,
`givenWideSchema_whenCompletingFrom_thenAnswersUnder100ms`,
`givenStaleDocumentVersion_whenResponseArrives_thenDropped`.

Docs: specification "Completion and navigation" section (requests, contexts, actions);
design-system completion popup tokens; AGENTS.md if layout changes.

Every phase ends with `bun run typecheck` and `bun run test` both green; phases touching plugins
also run `bun run test:db`.

---

## Live test

Run with `TABLE_CRAFT_EVIDENCE_DIR=docs/evidence/009 bun run test:smoke:db`, suite
`test/e2e/completion.smoke.test.ts`, 1200×800.

| #   | Scenario                                                                                     | Database | Result                                                                                                                                                                                 | Evidence                  |
| --- | -------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 1   | `SELECT * FROM ` + ⌃Space lists tables and views with glyphs                                 | pg       | Pass. `Line Items`, `customer_totals` (eye), `customers`, `edit_probe`, `no_key_probe`, `orders`, `type_probe`, then `archive`; every row has a glyph and `public` as detail           | from-relations.png        |
| 2   | `SELECT o. FROM orders o` lists `orders` columns with types                                  | mysql    | Pass. `id int`, `customer_id int`, `total decimal(12,2)`, `placed_at datetime`, in table order (deviation 10)                                                                          | alias-columns.png         |
| 3   | `WITH t AS (SELECT id, name FROM customers) SELECT t.` lists `id`, `name`                    | sqlite   | Pass. Exactly `id`, `name`                                                                                                                                                             | cte-columns.png           |
| 4   | `FROM orders o JOIN ` puts `customers c ON c.id = o.customer_id` first; accepting inserts it | pg       | Pass. First item, detail `orders_customer_id_fkey`; Enter writes `SELECT * FROM orders o JOIN customers c ON c.id = o.customer_id`                                                     | join-on.png               |
| 5   | `FROM Li` completes to `"Line Items"` (pg/sqlite) and `` `Line Items` `` (mysql)             | all      | Pass on all three; the screenshot is MySQL after accepting                                                                                                                             | quoted-identifier.png     |
| 6   | `FROM archive.` lists `old_orders` (described on demand)                                     | pg       | Pass. `archive` still collapsed in the pane; `old_orders` is the only item                                                                                                             | other-schema.png          |
| 7   | WHERE bar of `orders` completes `customer_id`                                                | pg       | Pass. Typing `cust` opens the popup with `customer_id integer`; Enter accepts it                                                                                                       | where-bar.png             |
| 8   | ⌘B on alias `o` moves the caret to `orders o`                                                | pg       | Pass. Caret at the start of `orders o`, which flashes                                                                                                                                  | goto-alias.png            |
| 9   | ⌘B on `customers` reveals and selects it in the Database pane                                | mysql    | Pass. `tables 6` expanded, `customers` selected, focus in the tree                                                                                                                     | goto-relation.png         |
| 10  | F4 on `orders` in the console opens `orders [pg]`                                            | pg       | Pass. Tab `orders [pg]` with its 3 rows                                                                                                                                                | open-data.png             |
| 11  | Disconnected console: ⌃Space offers keywords, no engine starts                               | sqlite   | Pass. After Disconnect, `WH` offers `WHEN`, `WHENEVER`, `WHERE`, `WHILE` with the keyword glyph; no engine process, status stays disconnected                                          | disconnected-keywords.png |
| 12  | Wide schema: completion after `FROM ` under 100 ms, timing shown in the test log             | sqlite   | Pass. 500 tables × 30 columns: keystroke to popup in 59.2 ms (59–61 ms over runs); `givenWideSchema_whenCompletingFrom_thenAnswersUnder100ms` holds the engine side to the same budget | wide-schema.png           |

Bugs found while testing are fixed with a regression test and listed under Deviations.

---

## Deviations taken while implementing

**1. Items carry no `from`/`to`; the span is the result's.** Every item of one answer replaces the
same prefix, so per-item spans would only repeat `CompletionResult.from`/`to`, which is what
CodeMirror takes.

**2. `CompletionCatalog` has no `relation(path, name)`.** The completer looks a name up in
`relations(path)` by the dialect's folding rules (`orders` matches `ORDERS` on PostgreSQL only when
unquoted); a catalog-side lookup would have to know those rules too. Its members are `current`,
`namespaces()`, `relations(path)` and `referencing(path, relation)`.

**3. `CompleterOptions` also take `dialect` and `quoteIdentifier`.** Scope analysis needs the
tokenizer's dialect options (dollar quotes, backslash escapes, `#` comments), and quoting a name is
the plugin's, so both come from the plugin rather than being guessed from `identifierFolding`.

**4. The statement at the caret is cut at the lexer's `;` delimiters, not by the splitter.** It is
cheaper on every keystroke and good enough for a caret; the cost is that a routine body under
MySQL's `DELIMITER` is not scoped (it completes keywords and current-namespace relations).

**5. Go to Declaration and Open Data connect a disconnected console's datasource; completion never
does.** They are explicit commands, like Run; completion fires while typing, so decision 028's
"never connects" holds for it alone.

**6. ⌘B and F4 on an alias go through the alias's relation.** Resolving `o` answers its
declaration; F4 resolves again at the declaration to open `orders`, and ⌘B on an alias jumps.
A CTE has no relation, so F4 on one does nothing.

**7. Go to Declaration on an alias moves the caret to the start of `orders o` and flashes the
span.** The renderer has no SQL to find the alias's own word in, and the flash shows which
declaration was meant. `ConsoleSession.jump` carries the request to the editor like `flash`.

**8. Revealing a relation describes its namespace in the renderer's catalog first.**
`navigation.resolve` answers a path and name but not the kind, and the tree's keys need it (`tables`
or `views`); `expandAll` only expands keys. The action expands the datasource and each namespace
prefix, which describes them, reads the kind, then reveals. A column reveals through the new
`columnRevealKeys`.

**9. The ORDER BY bar uses the same scope as the WHERE bar.** Both bars' text is read as the body of
a WHERE on the table, which offers its columns, functions and keywords; ORDER BY has no clause of
its own worth a second wrapper.

**10. CodeMirror breaks score ties alphabetically; the popup now keeps the engine's order.** Found
in live test row 2: `orders` columns came out `customer_id, id, placed_at, total`. The source
records each item's engine rank and passes `compareCompletions` (`compareByEngineOrder`) to
`autocompletion`, so equal fuzzy scores keep table order. Regression test
`givenTiedScores_whenSorted_thenEngineOrderBeatsTheAlphabet`.

**11. Relations come in catalog order, so `Line Items` is listed before `customers`.** A
case-insensitive sort was tried and reverted: the popup matches the Database pane, which lists
relations in the database's order.

**12. Renderer tests resolve `@codemirror/*` to the desktop package's copy.** The completion source
is unit-tested with CodeMirror's `CompletionContext`; two copies of `@codemirror/state` would break
its `instanceof` checks, so `vitest.config.ts` and `test/renderer/tsconfig.json` alias it.

**13. The live test waits 150 ms before accepting.** CodeMirror ignores Enter for its
`interactionDelay` (75 ms) after the popup opens, and Playwright presses faster than a person; the
suite's `acceptCompletion` waits `ACCEPT_AFTER_MS`. The product is unchanged.

**14. Row 12 measures keystroke to popup in the window.** The renderer's timing includes the port
round trip and rendering (59 ms); the engine's own budget is the unit test over a fake 500-table
catalog. The line goes to stderr because Vitest hides a passing test's console output.

**15. Older smoke suites count one more table.** `Line Items` moves `tables 5` to `tables 6` and
`tables 6` to `tables 7` in the explorer, console and table editor suites; the PostgreSQL `archive`
schema needed no change, as those suites address `public` by name.

---

## Out of scope

- Live templates, postfix completion, parameter hints: not in v1 (decision 014).
- Rename, find usages, introduce alias, qualify: refactorings are later.
- Quick documentation (F1) and ⌘B into DDL: plan 010.
- Per-console current schema and `SET search_path` / `USE` awareness: plan 011.
- Error highlighting of unknown tables or columns in the editor.
