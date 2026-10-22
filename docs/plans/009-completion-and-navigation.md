# Plan: Complete and navigate SQL from the catalog

Status: not started

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

| #   | Scenario                                                                                     | Database | Result | Evidence                  |
| --- | -------------------------------------------------------------------------------------------- | -------- | ------ | ------------------------- |
| 1   | `SELECT * FROM ` + ⌃Space lists tables and views with glyphs                                 | pg       |        | from-relations.png        |
| 2   | `SELECT o. FROM orders o` lists `orders` columns with types                                  | mysql    |        | alias-columns.png         |
| 3   | `WITH t AS (SELECT id, name FROM customers) SELECT t.` lists `id`, `name`                    | sqlite   |        | cte-columns.png           |
| 4   | `FROM orders o JOIN ` puts `customers c ON c.id = o.customer_id` first; accepting inserts it | pg       |        | join-on.png               |
| 5   | `FROM Li` completes to `"Line Items"` (pg/sqlite) and `` `Line Items` `` (mysql)             | all      |        | quoted-identifier.png     |
| 6   | `FROM archive.` lists `old_orders` (described on demand)                                     | pg       |        | other-schema.png          |
| 7   | WHERE bar of `orders` completes `customer_id`                                                | pg       |        | where-bar.png             |
| 8   | ⌘B on alias `o` moves the caret to `orders o`                                                | pg       |        | goto-alias.png            |
| 9   | ⌘B on `customers` reveals and selects it in the Database pane                                | mysql    |        | goto-relation.png         |
| 10  | F4 on `orders` in the console opens `orders [pg]`                                            | pg       |        | open-data.png             |
| 11  | Disconnected console: ⌃Space offers keywords, no engine starts                               | sqlite   |        | disconnected-keywords.png |
| 12  | Wide schema: completion after `FROM ` under 100 ms, timing shown in the test log             | sqlite   |        | wide-schema.png           |

Bugs found while testing are fixed with a regression test and listed under Deviations.

---

## Deviations taken while implementing

---

## Out of scope

- Live templates, postfix completion, parameter hints: not in v1 (decision 014).
- Rename, find usages, introduce alias, qualify: refactorings are later.
- Quick documentation (F1) and ⌘B into DDL: plan 010.
- Per-console current schema and `SET search_path` / `USE` awareness: plan 011.
- Error highlighting of unknown tables or columns in the editor.
