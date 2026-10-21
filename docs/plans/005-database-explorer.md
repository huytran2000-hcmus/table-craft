# Plan: Browse every schema in the Database pane

Status: not started

## The issue

After plan 004 the Database pane lists folders and datasources and stops there
(`packages/desktop/src/renderer/model/datasourceTree.ts:16`, `TreeNode = FolderNode | DatasourceNode`).
A user who connects to the `test:db` PostgreSQL cannot see that it has a `public` schema holding
`customers`, `orders` and `type_probe`, what columns `orders` has, or that `orders.customer_id`
points at `customers.id`. In DataGrip this tree is the first thing anyone looks at after connecting:
`store > tables 8 > customers > columns`.

Nothing in the stack can answer the question yet: plugin-api declares only `sql` and `cancel`
(`packages/plugin-api/src/plugin.ts:8`), the protocol has no metadata call
(`packages/desktop/src/engine/protocol.ts:106`), and the status bar slot meant for "synchronized
(501 ms)" is still a comment (`packages/desktop/src/renderer/shell/statusItems.tsx:14`).

Decision 022 settles the shape: list namespaces cheaply, describe one schema at a time, cache in the
engine.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | New capability `schemaTree`. A plugin declaring it returns a session whose `introspector` is present: `namespaces()` and `describe(path)` (decision 022). API_VERSION becomes `0.4.0`                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2   | `Namespace { path: string[]; name; kind: "database" \| "schema"; system: boolean; current: boolean }`. PostgreSQL: the connected database, then its schemas, so paths are `[db, schema]`. MySQL: databases as `[db]`, `kind: "schema"` (MySQL's schema is its database). SQLite: `main` plus attached databases as `[name]`                                                                                                                                                                                                                                                                                         |
| 3   | `describe` returns `NamespaceCatalog { path; relations; routines; sequences }`. `Relation { name; kind: "table" \| "view" \| "materializedView"; comment; columns; primaryKey; uniqueKeys; foreignKeys; indexes }`. `ColumnMeta { name; position; type (database text); nullable; default (database text or null); comment; autoIncrement }`. `ForeignKey { name; columns; target: { path; relation; columns }; onDelete; onUpdate }`. `Index { name; columns; unique; primary }`. `Routine { name; kind: "function" \| "procedure" }`. `Sequence { name }`. Triggers, checks, partitions, users and grants are out |
| 4   | Introspection runs on one dedicated session per engine, opened on first use and closed with the engine (decision 022)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 5   | Core `catalog/cache.ts` holds described catalogs by path with `introspectedAt` and `elapsedMs`. A second `describe` of the same path while one is in flight joins it instead of querying twice                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 6   | Protocol: `catalog.namespaces { refresh?: boolean }` → `Namespace[]`, and `catalog.describe { path; refresh?: boolean }` → `{ catalog; introspectedAt; elapsedMs }`. Both run over the window's existing port for the datasource; the renderer never opens a second                                                                                                                                                                                                                                                                                                                                                 |
| 7   | Expanding a disconnected datasource connects it first, as DataGrip does. Expanding a namespace describes it. The current namespace (`current: true`) is described and expanded automatically on the first connect of a session                                                                                                                                                                                                                                                                                                                                                                                      |
| 8   | Renderer `state/catalog.ts` holds namespaces and catalogs per datasource. It is cleared when the datasource detaches for any reason, clean or not (`state/datasources.ts:254`), and refilled on the next expand                                                                                                                                                                                                                                                                                                                                                                                                     |
| 9   | The tree is one flat, virtualized list (`@tanstack/react-virtual`, already a dependency) built by a pure `model/explorerTree.ts` that extends the plan 004 folder tree with namespace and object nodes                                                                                                                                                                                                                                                                                                                                                                                                              |
| 10  | Node layout under a namespace follows DataGrip: group nodes with counts (`tables 3`, `views 1`, `routines 0` hidden when empty, `sequences`). A table expands to `columns N`, `keys`, `foreign keys`, `indexes`. A column row shows `name  type`, with icons for primary key, foreign key and NOT NULL. Group nodes exist only when non-empty                                                                                                                                                                                                                                                                       |
| 11  | System namespaces are hidden unless `explorer.toggleSystemSchemas` is on. The setting is per window in the layout store, not per datasource                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 12  | Speed search, as in DataGrip: with the tree focused, typing a printable character opens a small search field over the tree; matching rows among **loaded** nodes highlight their matched characters and the selection jumps to the first match; ↑/↓ move between matches; Enter keeps the selection; Esc closes. It never triggers introspection. Matching reuses `model/fuzzy.ts`                                                                                                                                                                                                                                  |
| 13  | Search Everywhere gains a `Tables` tab: a `SearchProvider` (`model/palette.ts:29`) over every loaded catalog's relations, titled `customers` with `pg › table_craft › public` as detail. Choosing one reveals and selects it in the tree                                                                                                                                                                                                                                                                                                                                                                            |
| 14  | Actions (decision 015): `database.synchronize` (Mod+Alt+Y, as in IntelliJ; refreshes the selected namespace, or the namespace list on a datasource node), `explorer.collapseAll` (Mod+Minus with the tree focused), `explorer.toggleSystemSchemas`, `explorer.copyName` (Mod+Alt+Shift+C, copies the qualified name as the plugin quotes it, see 15). Expand/collapse by keyboard stays in the tree's own key handler, as in plan 004                                                                                                                                                                               |
| 15  | Quoting a qualified name is SQL knowledge, so the plugin does it (decision 008): `introspector.qualifiedName(path, name)` returns e.g. `"public"."customers"` or `` `table_craft`.`customers` ``. The engine answers `catalog.qualifiedName`; the renderer never quotes                                                                                                                                                                                                                                                                                                                                             |
| 16  | Status bar: for the active datasource, `public synchronized (38 ms) · 2 min ago`, from the most recent `describe` of the selected or current namespace. Relative time updates once a minute                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 17  | An introspection failure (for example, permission denied on one schema) marks that namespace node failed with the error's message and hint. Synchronize retries it. Other namespaces are unaffected                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 18  | The fixture schema gains, in all three dialects, a view `customer_totals` (customer id, name, sum of order totals) and an index `orders_placed_at_idx` on `orders (placed_at)`. The contract suite asserts against them                                                                                                                                                                                                                                                                                                                                                                                             |

### Consequences worth naming

**This changes the plugin contract.** `schemaTree`, `Introspector`, the catalog types, and
`ContractFixture.catalog` (the expected namespace path and the fixture objects) land in plugin-api.
API_VERSION goes to `0.4.0`, and all three built-in manifests move with it.

**This crosses the fence.** Three new requests: `catalog.namespaces`, `catalog.describe`,
`catalog.qualifiedName`. `Capability` in `protocol.ts` gains `schemaTree`, pinned by the existing
protocol test.

**This changes the shared fixture.** `customer_totals` and `orders_placed_at_idx` are added to all
three seeds. Existing assertions read `customers`, `orders` and `type_probe` by name and are
unaffected; the plan 002 type-probe evidence does not change.

**This default was chosen without asking.** Auto-describe of the current namespace on connect. It
costs one introspection per connect and makes the tree useful at once. It is not configurable in
v1.

**This default was chosen without asking.** PostgreSQL lists only the connected database, not every
database on the server. Browsing other databases means another datasource, until a later plan adds
per-datasource database selection.

---

## Phase 0 — plugin-api and the three introspectors

| File                                       | Responsibility                                                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/plugin-api/src/catalog.ts`       | `Namespace`, `NamespaceCatalog`, `Relation`, `ColumnMeta`, `ForeignKey`, `Index`, `Routine`, `Sequence`, `Introspector`                         |
| `packages/plugin-api/src/plugin.ts`        | `schemaTree` in `CAPABILITIES`; `Session.introspector?`, present exactly when declared                                                          |
| `packages/plugin-api/src/testing/index.ts` | catalog cases, gated on `schemaTree`                                                                                                            |
| `plugins/postgres/src/introspect.ts`       | `pg_catalog` queries (not `information_schema`, which hides objects the user cannot write and is slow), one per object family, joined in memory |
| `plugins/mysql/src/introspect.ts`          | `information_schema` queries filtered by `TABLE_SCHEMA = ?`                                                                                     |
| `plugins/sqlite/src/introspect.ts`         | `pragma_table_list`, `pragma_table_xinfo`, `pragma_foreign_key_list`, `pragma_index_list` / `pragma_index_info`                                 |

```ts
export interface Introspector {
  namespaces(): Promise<readonly Namespace[]>;
  /** Rejects with a `PluginError` coded `introspectionFailed` when the namespace cannot be read. */
  describe(path: readonly string[]): Promise<NamespaceCatalog>;
  qualifiedName(path: readonly string[], name: string): string;
}
```

- Every list in a catalog is sorted by name (columns by position), so snapshots are stable.
- `introspectionFailed` joins the plugin error codes and the engine error codes.

## Phase 1 — engine and core

- `packages/core/src/catalog/cache.ts`: `CatalogCache` over an `Introspector`, with `namespaces(refresh)`, `describe(path, refresh)` (in-flight joining), and `clear()`.
- `packages/desktop/src/engine/engine.ts`: lazily open the introspection session, route the three `catalog.*` requests, map `introspectionFailed`.
- `packages/desktop/src/engine/requests.ts`: Zod schemas for the new requests.

## Phase 2 — renderer

| File                                  | Responsibility                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `renderer/model/explorerTree.ts`      | pure: folders + datasources + namespaces + catalogs + expansion + system toggle → flat visible rows with depth, kind, label, detail, icon key, counts, status |
| `renderer/model/speedSearch.ts`       | pure: rows + query → matches with highlight ranges, next/previous                                                                                             |
| `renderer/state/catalog.ts`           | per-datasource namespaces, catalogs, in-flight and failed states, `introspectedAt`; cleared on detach                                                         |
| `renderer/panes/DatabasePane.tsx`     | virtualized rows, speed search field, node icons, auto-expand of the current namespace                                                                        |
| `renderer/actions/explorerActions.ts` | the four actions in decision 14                                                                                                                               |
| `renderer/palette/tablesProvider.ts`  | the `Tables` tab                                                                                                                                              |
| `renderer/shell/statusItems.tsx`      | the synchronized slot                                                                                                                                         |

```ts
const SPEED_SEARCH_MAX_LENGTH = 64;
const SYNC_LABEL_TICK_MS = 60_000;
```

| Situation                                        | Result                                                                             |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Expand disconnected datasource                   | connect, then list namespaces, then describe current and expand it                 |
| Expand namespace never described                 | spinner row `loading…`, then groups                                                |
| Describe fails                                   | namespace row in danger colour, tooltip with message and hint; Synchronize retries |
| Engine exits while a describe is in flight       | request rejected, catalog cleared, datasource row shows the plan 004 state         |
| Speed search with no match                       | field turns danger colour, selection unchanged                                     |
| System schemas toggled off while one is selected | selection moves to the datasource node                                             |

## Phase 3 — Fixtures, tests, docs

Fixture schema, all three of `test/db/schema/{postgres,mysql,sqlite}.sql` and the seeded SQLite in
`test/support/`:

- `customer_totals` view and `orders_placed_at_idx` index (decision 18).

New `test/core/catalogCache.test.ts`, `test/renderer/explorerTree.test.ts`,
`test/renderer/speedSearch.test.ts`, `test/renderer/catalogStore.test.ts`; contract cases in
plugin-api's suite; `test/e2e/explorer.smoke.test.ts` for the live test.

New cases:

`givenSchemaTreePlugin_whenNamespacesListed_thenCurrentNamespaceIsMarked`,
`givenFixture_whenDescribed_thenCustomersOrdersTypeProbeAndCustomerTotalsArePresent`,
`givenOrders_whenDescribed_thenForeignKeyTargetsCustomersId`,
`givenOrders_whenDescribed_thenIndexOrdersPlacedAtIdxIsListed`,
`givenCustomers_whenDescribed_thenIdIsPrimaryKeyAndEmailIsUnique`,
`givenUnknownNamespace_whenDescribed_thenRejectsWithIntrospectionFailed`,
`givenIdentifierNeedingQuotes_whenQualified_thenPluginQuotesIt`,
`givenTwoConcurrentDescribes_whenSamePath_thenIntrospectsOnce`,
`givenCachedCatalog_whenDescribedWithRefresh_thenIntrospectsAgain`,
`givenSystemSchemasHidden_whenTreeBuilt_thenSystemNamespacesAreAbsent`,
`givenTableWithNoIndexes_whenTreeBuilt_thenNoIndexesGroup`,
`givenCollapsedTable_whenTreeBuilt_thenColumnsAreNotRows`,
`givenSpeedSearchQuery_whenMatched_thenOnlyLoadedRowsAreSearched`,
`givenSpeedSearchMatches_whenNextPressed_thenWrapsToFirst`,
`givenDatasourceDetached_whenCatalogStoreNotified_thenItsCatalogsAreCleared`,
`givenLoadedCatalogs_whenTablesProviderSearched_thenReturnsRelationsWithPath`,
`givenNewCapability_whenProtocolCompared_thenMatchesPluginApi`.

Docs: `docs/design/specification.md` gains a "Database explorer" section (node kinds, actions,
protocol calls). `docs/design/design-system.md` names the node icon and speed search tokens.
`AGENTS.md` layout mentions `catalog/` in core if the line needs it.

Every phase ends with `bun run typecheck` and `bun run test` both green; phases 0 and 1 also run
`bun run test:db`.

---

## Live test

Captured at 1200×800 into `docs/evidence/005/` by `test/e2e/explorer.smoke.test.ts`, regenerated
with `TABLE_CRAFT_EVIDENCE_DIR=docs/evidence/005 bun run test:smoke:db`.

| #   | Scenario                                                                                                                                          | Database | Result | Evidence                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ | ------------------------------ |
| 1   | Connect; `public` is described and expanded automatically, showing `tables 3`, `views 1`                                                          | postgres |        | `postgres-auto-expanded.png`   |
| 2   | Expand `orders`: `columns 4`, `keys`, `foreign keys`, `indexes`; column rows show types and PK/FK icons                                           | postgres |        | `postgres-orders-expanded.png` |
| 3   | Same tree on MySQL, database `table_craft`                                                                                                        | mysql    |        | `mysql-tree.png`               |
| 4   | Same tree on SQLite, `main`                                                                                                                       | sqlite   |        | `sqlite-tree.png`              |
| 5   | Toggle system schemas on: `pg_catalog` and `information_schema` appear; off again: gone                                                           | postgres |        | `system-schemas.png`           |
| 6   | Speed search `cust` highlights `customers` and `customer_totals`; ↓ moves to the second                                                           | postgres |        | `speed-search.png`             |
| 7   | Search Everywhere `Tables` tab, query `ord`; Enter reveals `orders` in the tree                                                                   | mysql    |        | `search-everywhere-tables.png` |
| 8   | Create a table from a console, Synchronize (⌥⌘Y), it appears; status bar shows the new sync time                                                  | postgres |        | `synchronized.png`             |
| 9   | A user without access to one schema: that namespace fails with message and hint, others load                                                      | postgres |        | `introspection-failed.png`     |
| 10  | Wide schema: 500 tables × 10 columns in a separate schema created by the test, described in under 2 s; tree scrolls to the end without blank rows | postgres |        | `wide-schema.png`              |
| 11  | Disconnect (⌘F2): catalog nodes disappear; expand again: reconnects and reloads                                                                   | mysql    |        | `reconnect-reload.png`         |
| 12  | Copy qualified name of `orders` on each database; clipboard holds the plugin's quoting                                                            | all      |        | `copy-name.png`                |

Bugs found by the live test are fixed in the same plan, each with a regression test, and listed
under Deviations.

---

## Deviations taken while implementing

---

## Out of scope

- Opening table data (F4) and foreign-key navigation: plan 008.
- DDL (⌘B), SQL generator, and quick documentation (F1): plan 010.
- Completion from the catalog: plan 009 reads the engine cache through the plugin.
- Refreshing a namespace automatically after DDL in a console: plan 006 may add it.
- Choosing which databases or schemas to introspect per datasource, and listing other PostgreSQL
  databases on the server: a later plan.
- Triggers, check constraints, partitions, users, roles and grants as nodes.
- Drag from the tree into an editor: plan 006, which brings CodeMirror.
- A grid whose engine has stopped still shows its last rows (plan 004 risk): plan 007 owns result
  lifetime.
