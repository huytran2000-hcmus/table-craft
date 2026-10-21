import type { Introspector, Namespace, NamespaceCatalog } from "@table-craft/plugin-api";

/** A catalog and when, and how fast, the database answered for it. */
export interface CachedCatalog {
  readonly catalog: NamespaceCatalog;
  /** Epoch milliseconds. */
  readonly introspectedAt: number;
  readonly elapsedMs: number;
}

function keyOf(path: readonly string[]): string {
  return JSON.stringify(path);
}

/**
 * What the engine has read about its datasource, by namespace path (decision 022). It lives as
 * long as the engine. A failure is never cached, so the next call asks the database again.
 */
export class CatalogCache {
  readonly #introspector: Introspector;
  readonly #now: () => number;
  #namespaces: Promise<readonly Namespace[]> | null = null;
  readonly #catalogs = new Map<string, CachedCatalog>();
  /** Concurrent describes of one path share the database round trip. */
  readonly #describing = new Map<string, Promise<CachedCatalog>>();

  constructor(introspector: Introspector, now: () => number = Date.now) {
    this.#introspector = introspector;
    this.#now = now;
  }

  namespaces(refresh = false): Promise<readonly Namespace[]> {
    if (refresh || this.#namespaces === null) {
      const listing = this.#introspector.namespaces();
      this.#namespaces = listing;
      listing.catch(() => {
        if (this.#namespaces === listing) this.#namespaces = null;
      });
    }
    return this.#namespaces;
  }

  describe(path: readonly string[], refresh = false): Promise<CachedCatalog> {
    const key = keyOf(path);
    const inFlight = this.#describing.get(key);
    if (inFlight !== undefined) return inFlight;
    const cached = this.#catalogs.get(key);
    if (!refresh && cached !== undefined) return Promise.resolve(cached);
    const describing = this.#read(path).finally(() => this.#describing.delete(key));
    this.#describing.set(key, describing);
    return describing;
  }

  async #read(path: readonly string[]): Promise<CachedCatalog> {
    const started = this.#now();
    const catalog = await this.#introspector.describe(path);
    const finished = this.#now();
    const described: CachedCatalog = { catalog, introspectedAt: finished, elapsedMs: finished - started };
    this.#catalogs.set(keyOf(path), described);
    return described;
  }

  clear(): void {
    this.#namespaces = null;
    this.#catalogs.clear();
  }
}
