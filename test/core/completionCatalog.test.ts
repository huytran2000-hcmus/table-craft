import { describe, expect, it } from "vitest";
import { CatalogCache, completionCatalog } from "@table-craft/core";
import type { Introspector, Namespace, NamespaceCatalog } from "@table-craft/plugin-api";
import { ARCHIVE, PUBLIC, foreignKey, relation } from "../support/completionCatalog.js";

const NAMESPACES: readonly Namespace[] = [
  { path: PUBLIC, name: "public", kind: "schema", system: false, current: true },
  { path: ARCHIVE, name: "archive", kind: "schema", system: false, current: false },
];
const SHORT_DEADLINE_MS = 20;

const CATALOGS: Record<string, NamespaceCatalog> = {
  [JSON.stringify(PUBLIC)]: {
    path: PUBLIC,
    relations: [relation("customers", [["id", "integer"]])],
    routines: [],
    sequences: [],
  },
  [JSON.stringify(ARCHIVE)]: {
    path: ARCHIVE,
    relations: [
      relation(
        "old_orders",
        [["id", "integer"]],
        [foreignKey("old_orders_customer_id_fkey", ["customer_id"], PUBLIC, "customers", ["id"])],
      ),
    ],
    routines: [],
    sequences: [],
  },
};

/** Describes after `delayMs`, or never when the path is held. */
function introspector(
  delayMs: number,
  held: readonly (readonly string[])[] = [],
): Introspector & { describes: string[] } {
  const describes: string[] = [];
  return {
    describes,
    namespaces: () => Promise.resolve(NAMESPACES),
    describe: (path) => {
      describes.push(path.join("."));
      if (held.some((candidate) => JSON.stringify(candidate) === JSON.stringify(path))) {
        return new Promise(() => undefined);
      }
      const catalog = CATALOGS[JSON.stringify(path)];
      if (catalog === undefined) return Promise.reject(new Error(`no namespace ${path.join(".")}`));
      return new Promise((resolve) => setTimeout(() => resolve(catalog), delayMs));
    },
    qualifiedName: (path, name) => [...path, name].join("."),
  };
}

describe("completionCatalog", () => {
  it("givenNamespaces_whenOpened_thenCurrentIsTheCurrentNamespacePath", async () => {
    const catalog = await completionCatalog(new CatalogCache(introspector(0)));

    expect(catalog.current).toEqual(PUBLIC);
    expect((await catalog.namespaces()).map((namespace) => namespace.name)).toEqual(["public", "archive"]);
  });

  it("givenUndescribedNamespace_whenCompleting_thenDescribesWithinDeadline", async () => {
    const fake = introspector(5);
    const cache = new CatalogCache(fake);
    const catalog = await completionCatalog(cache, { deadlineMs: 500 });

    const relations = await catalog.relations(ARCHIVE);

    expect(relations.map((relation) => relation.name)).toEqual(["old_orders"]);
    expect(cache.cached(ARCHIVE)).toBeDefined();
    expect(fake.describes).toEqual(["table_craft.archive"]);
  });

  it("givenDescribeSlowerThanDeadline_whenCompleting_thenAnswersFromCache", async () => {
    const cache = new CatalogCache(introspector(0, [ARCHIVE]));
    const catalog = await completionCatalog(cache, { deadlineMs: SHORT_DEADLINE_MS });
    const started = Date.now();

    const relations = await catalog.relations(ARCHIVE);

    expect(relations).toEqual([]);
    expect(Date.now() - started).toBeLessThan(SHORT_DEADLINE_MS * 10);
  });

  it("givenDescribedNamespace_whenCompletingAgain_thenAnswersWithoutAskingTheDatabase", async () => {
    const fake = introspector(0);
    const cache = new CatalogCache(fake);
    await cache.describe(PUBLIC);
    const catalog = await completionCatalog(cache);

    expect((await catalog.relations(PUBLIC)).map((relation) => relation.name)).toEqual(["customers"]);
    expect(fake.describes).toEqual(["table_craft.public"]);
  });

  it("givenFailingDescribe_whenCompleting_thenNoRelations", async () => {
    const catalog = await completionCatalog(new CatalogCache(introspector(0)));

    expect(await catalog.relations(["table_craft", "missing"])).toEqual([]);
  });

  it("givenDescribedReferencingNamespace_whenAskedForReferences_thenListsIncomingForeignKey", async () => {
    const cache = new CatalogCache(introspector(0));
    await cache.describe(ARCHIVE);
    const catalog = await completionCatalog(cache);

    const incoming = await catalog.referencing(PUBLIC, "customers");

    expect(incoming.map(({ path, relation }) => ({ path, relation }))).toEqual([
      { path: ARCHIVE, relation: "old_orders" },
    ]);
  });
});
