import { create } from "zustand";
import type { ObjectFeatures } from "@table-craft/desktop/engine/protocol.js";
import type { DatasourcesStore } from "@table-craft/desktop/renderer/state/datasources.js";
import { capabilitiesOf, useDatasources } from "@table-craft/desktop/renderer/state/datasources.js";

const OBJECTS = "objects";

/**
 * What each plugin's object editor can write (plan 024), by plugin id. The tree's menus decide
 * synchronously which object actions apply, so the answer is fetched once a datasource of that
 * plugin connects and kept for the window's life: it is the plugin's, not the database's.
 */
export interface ObjectsState {
  readonly features: Readonly<Record<string, ObjectFeatures>>;
  readonly learned: (pluginId: string, features: ObjectFeatures) => void;
}

export function createObjectsStore() {
  return create<ObjectsState>()((set, get) => ({
    features: {},
    learned(pluginId, features) {
      set({ features: { ...get().features, [pluginId]: features } });
    },
  }));
}

export type ObjectsStore = ReturnType<typeof createObjectsStore>;

export const useObjects = createObjectsStore();

/** The features of the datasource's plugin, once learned; null before or when it declares no `objects`. */
export function featuresOf(datasourceId: string): ObjectFeatures | null {
  const view = useDatasources.getState().datasources.find((candidate) => candidate.id === datasourceId);
  if (view === undefined) return null;
  return useObjects.getState().features[view.pluginId] ?? null;
}

/** Asks a datasource's engine for its plugin's object features the first time one of that plugin connects. */
export function followObjectFeatures(datasources: DatasourcesStore, objects: ObjectsStore): () => void {
  const asked = new Set<string>();
  return datasources.subscribe((state, previous) => {
    for (const [id, connection] of Object.entries(state.connections)) {
      if (connection.status !== "connected" || previous.connections[id]?.status === "connected") continue;
      const datasource = state.datasources.find((candidate) => candidate.id === id);
      if (datasource === undefined || asked.has(datasource.pluginId)) continue;
      if (!capabilitiesOf(state.plugins, datasource.pluginId).includes(OBJECTS)) continue;
      const { pluginId } = datasource;
      asked.add(pluginId);
      void (async () => {
        try {
          const client = await datasources.getState().connect(id);
          objects.getState().learned(pluginId, await client.call("objects.features", {}));
        } catch {
          asked.delete(pluginId);
        }
      })();
    }
  });
}
