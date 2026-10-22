import { create } from "zustand";
import type { EngineError } from "@table-craft/desktop/engine/protocol.js";
import type { EngineClient } from "@table-craft/desktop/renderer/engine/client.js";
import { pathKey } from "@table-craft/desktop/renderer/model/explorerTree.js";
import type { CatalogStore } from "@table-craft/desktop/renderer/state/catalog.js";
import { useDatasources } from "@table-craft/desktop/renderer/state/datasources.js";
import { toError } from "@table-craft/desktop/renderer/state/resultWindows.js";

/** Which relation a DDL tab shows (plan 010 decision 8). */
export interface DdlTarget {
  readonly datasourceId: string;
  readonly path: readonly string[];
  readonly relation: string;
}

export interface DdlTab extends DdlTarget {
  /** The definition as the database last answered it; kept while a refresh is in flight. */
  readonly text: string | null;
  readonly loading: boolean;
  readonly error: EngineError | null;
}

export interface DdlState {
  /** By tab id. */
  readonly ddls: Readonly<Record<string, DdlTab>>;
  /** Adds a DDL tab and reads its definition. */
  readonly open: (id: string, target: DdlTarget) => Promise<void>;
  /** Reads the definition again; the database is asked every time (decision 029). */
  readonly refresh: (id: string) => Promise<void>;
  readonly close: (id: string) => void;
}

export interface DdlDependencies {
  readonly connect: (datasourceId: string) => Promise<EngineClient>;
}

export function sameRelation(a: DdlTarget, b: DdlTarget): boolean {
  return (
    a.datasourceId === b.datasourceId &&
    a.relation === b.relation &&
    a.path.length === b.path.length &&
    a.path.every((part, index) => part === b.path[index])
  );
}

export function createDdlStore(dependencies: DdlDependencies) {
  /** The latest read per tab, so an answer overtaken by a later refresh is dropped. */
  const reads = new Map<string, number>();
  let readCount = 0;

  return create<DdlState>()((set, get) => {
    function patch(id: string, change: Partial<DdlTab>): void {
      const current = get().ddls[id];
      if (current === undefined) return;
      set({ ddls: { ...get().ddls, [id]: { ...current, ...change } } });
    }

    async function read(id: string): Promise<void> {
      const current = get().ddls[id];
      if (current === undefined) return;
      const token = ++readCount;
      reads.set(id, token);
      patch(id, { loading: true, error: null });
      try {
        const client = await dependencies.connect(current.datasourceId);
        const text = await client.call("catalog.definition", { path: current.path, name: current.relation });
        if (reads.get(id) === token) patch(id, { text, loading: false, error: null });
      } catch (cause) {
        if (reads.get(id) === token) patch(id, { loading: false, error: toError(cause) });
      }
    }

    return {
      ddls: {},

      async open(id, target) {
        const { datasourceId, path, relation } = target;
        set({
          ddls: { ...get().ddls, [id]: { datasourceId, path, relation, text: null, loading: false, error: null } },
        });
        await read(id);
      },

      refresh: read,

      close(id) {
        reads.delete(id);
        const { [id]: _gone, ...ddls } = get().ddls;
        set({ ddls });
      },
    };
  });
}

export type DdlStore = ReturnType<typeof createDdlStore>;

export const useDdl = createDdlStore({ connect: (id) => useDatasources.getState().connect(id) });

/** The DDL tabs open on a datasource, by tab id. */
export function ddlsOf(ddls: DdlState["ddls"], datasourceId: string): readonly string[] {
  return Object.entries(ddls)
    .filter(([, tab]) => tab.datasourceId === datasourceId)
    .map(([id]) => id);
}

/**
 * Reads an open tab's definition again whenever the catalog describes its namespace anew, which
 * it does after DDL runs in a console (plan 006) or on Synchronize.
 */
export function followRedescribes(ddl: DdlStore, catalog: CatalogStore): () => void {
  return catalog.subscribe((state, previous) => {
    for (const [id, tab] of Object.entries(ddl.getState().ddls)) {
      const key = pathKey(tab.path);
      const before = previous.catalogs[tab.datasourceId]?.namespaceStates[key]?.described ?? null;
      const after = state.catalogs[tab.datasourceId]?.namespaceStates[key]?.described ?? null;
      if (before !== null && after !== null && before !== after) void ddl.getState().refresh(id);
    }
  });
}
