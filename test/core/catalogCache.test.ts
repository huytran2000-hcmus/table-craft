import { describe, expect, it } from "vitest";
import { CatalogCache } from "@table-craft/core";
import { PluginError, type Introspector, type Namespace, type NamespaceCatalog } from "@table-craft/plugin-api";

const PATH = ["table_craft", "public"];
const NAMESPACES: readonly Namespace[] = [{ path: PATH, name: "public", kind: "schema", system: false, current: true }];

function catalogOf(path: readonly string[]): NamespaceCatalog {
  return { path, relations: [], routines: [], sequences: [] };
}

/** Counts reads, and lets a test hold `describe` open until it says. */
function fakeIntrospector() {
  let describes = 0;
  let listings = 0;
  let failNext = false;
  let release: (() => void) | null = null;
  const introspector: Introspector = {
    namespaces: () => {
      listings += 1;
      return Promise.resolve(NAMESPACES);
    },
    describe: (path) => {
      describes += 1;
      if (failNext) {
        failNext = false;
        return Promise.reject(new PluginError("introspectionFailed", "permission denied for schema public"));
      }
      return new Promise((resolve) => {
        release = () => resolve(catalogOf(path));
      });
    },
    qualifiedName: (path, name) => [...path, name].join("."),
  };
  return {
    introspector,
    describes: () => describes,
    listings: () => listings,
    failNext: () => {
      failNext = true;
    },
    release: () => {
      release?.();
      release = null;
    },
  };
}

function clock(...ticks: number[]): () => number {
  return () => ticks.shift() ?? 0;
}

describe("CatalogCache", () => {
  it("givenTwoConcurrentDescribes_whenSamePath_thenIntrospectsOnce", async () => {
    const fake = fakeIntrospector();
    const cache = new CatalogCache(fake.introspector, clock(100, 138));

    const first = cache.describe(PATH);
    const second = cache.describe([...PATH]);
    fake.release();

    expect(await first).toBe(await second);
    expect(fake.describes()).toBe(1);
    expect(await first).toEqual({ catalog: catalogOf(PATH), introspectedAt: 138, elapsedMs: 38 });
  });

  it("givenCachedCatalog_whenDescribedAgain_thenServedWithoutIntrospecting", async () => {
    const fake = fakeIntrospector();
    const cache = new CatalogCache(fake.introspector);
    const first = cache.describe(PATH);
    fake.release();
    await first;

    await cache.describe(PATH);

    expect(fake.describes()).toBe(1);
  });

  it("givenCachedCatalog_whenDescribedWithRefresh_thenIntrospectsAgain", async () => {
    const fake = fakeIntrospector();
    const cache = new CatalogCache(fake.introspector, clock(1, 2, 10, 15));
    const first = cache.describe(PATH);
    fake.release();
    await first;

    const refreshed = cache.describe(PATH, true);
    fake.release();

    expect((await refreshed).introspectedAt).toBe(15);
    expect(fake.describes()).toBe(2);
  });

  it("givenFailedDescribe_whenDescribedAgain_thenIntrospectsAgain", async () => {
    const fake = fakeIntrospector();
    const cache = new CatalogCache(fake.introspector);
    fake.failNext();
    await expect(cache.describe(PATH)).rejects.toMatchObject({ code: "introspectionFailed" });

    const retried = cache.describe(PATH);
    fake.release();

    expect((await retried).catalog).toEqual(catalogOf(PATH));
    expect(fake.describes()).toBe(2);
  });

  it("givenListedNamespaces_whenListedAgain_thenCachedUntilRefresh", async () => {
    const fake = fakeIntrospector();
    const cache = new CatalogCache(fake.introspector);

    await cache.namespaces();
    await cache.namespaces();
    await cache.namespaces(true);

    expect(fake.listings()).toBe(2);
  });

  it("givenCleared_whenDescribed_thenIntrospectsAgain", async () => {
    const fake = fakeIntrospector();
    const cache = new CatalogCache(fake.introspector);
    const first = cache.describe(PATH);
    fake.release();
    await first;

    cache.clear();
    const again = cache.describe(PATH);
    fake.release();
    await again;

    expect(fake.describes()).toBe(2);
  });
});
