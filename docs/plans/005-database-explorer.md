# Plan: Browse every schema in the Database pane

Status: done. The Database pane now opens every datasource into its catalog, the way DataGrip
does. plugin-api is `0.4.0` with a `schemaTree` capability: each built-in plugin's
`introspect.ts` lists namespaces, describes one into relations, columns, keys, foreign keys,
indexes, routines and sequences, and quotes a qualified name, all checked by the contract suite
against the fixture's new `customer_totals` view and `orders_placed_at_idx` index. The engine
introspects on its own session and caches by namespace in core's `CatalogCache`; the renderer keeps
a copy per datasource that dies on any detach, and draws one virtualized tree with DataGrip's groups
and counts, speed search, Synchronize (`⌥⌘Y`), Collapse All, Show System Schemas, Copy Qualified
Name, a `Tables` tab in Search Everywhere and the last synchronization in the status bar. All twelve
live-test rows pass, including 500 tables described in about 60 ms. The screenshots exposed six
bugs (speed search marking `cus`+`t`, a console connect leaving the tree shut, a failed schema
showing nothing under it, column names squeezed to an ellipsis, a pane that grew to its content and
so rendered every row, and a long sync message truncating the datasource's status), each fixed
with a test. Reality differed mostly in the edges: a failed schema shows its error as a row and in
the status bar, not only a tooltip; the tree opens on any connect, console included; and Select in
Database View became an action of its own so the `Tables` tab goes through the registry.

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

| #   | Scenario                                                                                                                                          | Database | Result                                                                                                                                                                                                         | Evidence                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 1   | Connect; `public` is described and expanded automatically, showing `tables 3`, `views 1`                                                          | postgres | Pass. `pg › table_craft › public` opens on connect with `tables 3` and `views 1`; the status bar reads `public synchronized (… ms) · just now`                                                                 | `postgres-auto-expanded.png`   |
| 2   | Expand `orders`: `columns 4`, `keys`, `foreign keys`, `indexes`; column rows show types and PK/FK icons                                           | postgres | Pass. `columns 4`, `keys 1`, `foreign keys 1`, `indexes 2`; `id integer` with the gold key, `customer_id integer` with the blue key, `placed_at timestamp without time zone`, NOT NULL marks                   | `postgres-orders-expanded.png` |
| 3   | Same tree on MySQL, database `table_craft`                                                                                                        | mysql    | Pass. `table_craft` opens with `tables 3`, `views 1`; `orders` has `columns 4`, `keys 1`, `foreign keys 1`, `indexes 3` (MySQL indexes the FK column itself)                                                   | `mysql-tree.png`               |
| 4   | Same tree on SQLite, `main`                                                                                                                       | sqlite   | Pass. `main` opens with `tables 3`, `views 1`; `orders` has `columns 4`, `keys 1`, `foreign keys 1`, `indexes 1`                                                                                               | `sqlite-tree.png`              |
| 5   | Toggle system schemas on: `pg_catalog` and `information_schema` appear; off again: gone                                                           | postgres | Pass. Show System Schemas (Find Action) adds `information_schema`, `pg_catalog` and `pg_toast`; toggled again, they are gone                                                                                   | `system-schemas.png`           |
| 6   | Speed search `cust` highlights `customers` and `customer_totals`; ↓ moves to the second                                                           | postgres | Pass after fix (Deviation 7). `cust` is marked in both names, `customers` is selected, ↓ selects `customer_totals`, Esc keeps it                                                                               | `speed-search.png`             |
| 7   | Search Everywhere `Tables` tab, query `ord`; Enter reveals `orders` in the tree                                                                   | mysql    | Pass. The tab lists `orders  mysql › table_craft`; Enter opens the path and selects and focuses `orders`                                                                                                       | `search-everywhere-tables.png` |
| 8   | Create a table from a console, Synchronize (⌥⌘Y), it appears; status bar shows the new sync time                                                  | postgres | Pass. After `CREATE TABLE explorer_new`, ⌥⌘Y turns `tables 3` into `tables 4` and the status bar into a fresh `public synchronized (… ms) · just now`                                                          | `synchronized.png`             |
| 9   | A user without access to one schema: that namespace fails with message and hint, others load                                                      | postgres | Pass after fix (Deviation 8). `explorer_restricted` turns red with `permission denied for schema explorer_restricted` and the Synchronize hint under it and in the status bar; `public` still shows `tables 3` | `introspection-failed.png`     |
| 10  | Wide schema: 500 tables × 10 columns in a separate schema created by the test, described in under 2 s; tree scrolls to the end without blank rows | postgres | Pass after fix (Deviation 10). `explorer_wide` is described in about 60 ms; End and ↑ reach `t500` with the toolbar in place, fewer than 500 rows rendered, no blank rows                                      | `wide-schema.png`              |
| 11  | Disconnect (⌘F2): catalog nodes disappear; expand again: reconnects and reloads                                                                   | mysql    | Pass. ⌘F2 removes `table_craft` and collapses the datasource; expanding reconnects and shows `tables 3` again                                                                                                  | `reconnect-reload.png`         |
| 12  | Copy qualified name of `orders` on each database; clipboard holds the plugin's quoting                                                            | all      | Pass. `"public"."orders"`, `` `table_craft`.`orders` `` and `"main"."orders"`; the last is pasted into a console for the screenshot                                                                            | `copy-name.png`                |

Bugs found by the live test are fixed in the same plan, each with a regression test, and listed
under Deviations.

---

## Deviations taken while implementing

1. **Select in Database View is an action of its own (`explorer.reveal`).** The `Tables` provider
   could have expanded the tree and set the selection itself, but decision 015 routes every command
   through `invoke`, so the provider runs the action with `{ datasourceId, path, name, kind }`. It
   opens the Database tool window, expands the path, selects the relation and focuses the tree;
   without arguments it selects the active datasource.
2. **PostgreSQL refuses to describe a schema the user lacks `USAGE` on.** `pg_catalog` is readable
   by everyone, so without the check row 9's schema would describe as empty rather than fail. The
   introspector asks `has_schema_privilege` first and rejects `introspectionFailed` with
   `permission denied for schema …`. Temporary schemas (`pg_temp_N`, `pg_toast_temp_N`) are not
   listed, `pg_toast` is a system schema, and overloaded routines are listed once by name.
3. **The introspection session belongs to the engine, which gained `close()`.** Sessions otherwise
   belong to a port; this one outlives ports so the cache does, and `engine/main.ts` closes it
   before exiting. A failed open is forgotten, so the next request tries again.
4. **The contract fixture gained `catalog { path, quoted }`.** The suite could not guess the
   namespace path or a dialect's quoting, so each run names them; the quoted name (`odd "name`)
   needs escaping in every dialect. Two cases beyond the plan's: the introspector is present
   exactly when `schemaTree` is declared, and a session still runs statements after introspecting.
5. **SQLite names its keys as DataGrip does.** SQLite keeps no constraint names, so the plugin
   writes `orders_pk` and `orders_customers_id_fk`; `temp` is its system namespace.
6. **The tree opens on any connect, not only the tree's own.** Live-test bug: connecting through a
   console left the datasource collapsed. `followAttaches` in `state/wiring.ts` now expands a
   `schemaTree` datasource whenever it attaches, which lists its namespaces and describes the
   current one. Regression: `givenConsoleConnectsDatasource_whenAttached_thenTreeOpensOnTheCurrentNamespace`.
7. **Live-test bug: speed search marked `cus` and the `t` of `totals`.** The palette's fuzzy scorer
   prefers word starts, which is right for Search Everywhere and wrong for speed search. Speed search
   now marks a contiguous run when there is one and falls back to the fuzzy positions
   (`fuzzy.match`, added for this). Regression in `test/renderer/speedSearch.test.ts`.
8. **Live-test bug: a failed namespace showed nothing under it,** and its hint lived only in a
   tooltip. An expanded failed namespace now has an error row (message, hint beside it), and the
   status bar shows `explorer_restricted failed: … Check that this user may read the schema…` while
   it is selected. Regressions:
   `givenDescribeFailed_whenNamespaceExpanded_thenAnErrorRowSaysWhyAndNoLoadingRow` and the
   `syncFailedText` case.
9. **Live-test bug: column names were squeezed to `c…`** by their types, and wide rows scrolled
   sideways. The name keeps its width and the detail truncates first; the tree never scrolls
   sideways. The live test also widens the Database pane by 160 px, since its default width cannot
   show `timestamp without time zone`; the smoke suite asserts a name's width.
10. **Live-test bug: the Database pane grew to its content.** The tool window body is a block that
    scrolls, so `flex-1` gave the pane no height: the virtualizer rendered every row and End
    scrolled the toolbar away. The pane is `h-full`; the smoke suite asserts the toolbar stays in
    view and fewer than 500 rows are rendered.
11. **Live-test bug: a long sync message truncated the datasource's status** (`PostgreSQL 17.1…`).
    The sync item takes only the space left (`basis-0`).
12. **The live test drops what it creates after every scenario.** Row 8's `explorer_new` broke later
    rows' `tables 3` on the first run. Role `explorer_limited` is created idempotently and left in
    place, since dropping a role that owns grants would need more cleanup than it is worth.
13. **Collapse All also collapses folders,** as DataGrip's does, and moves the selection to the top
    node. Its chord is written `Mod+-` (the keymap dispatches by `Minus`).
14. **Esc in speed search closes the field, not Back to Editor.** `ActionContext` gained
    `speedSearching`, and `focus.editor` stands aside while it is true.
15. **Show System Schemas lives in `table-craft.layout.v1`** as an optional field that defaults to
    off; a layout saved before this plan loads unchanged, so the key keeps its version.

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
