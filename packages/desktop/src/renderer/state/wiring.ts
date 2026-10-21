import { bridge } from "@table-craft/desktop/renderer/bridge.js";
import { useCatalog, type CatalogStore } from "@table-craft/desktop/renderer/state/catalog.js";
import { consolesOf, useConsoles, type ConsolesStore } from "@table-craft/desktop/renderer/state/consoles.js";
import {
  capabilitiesOf,
  useDatasources,
  type DatasourcesStore,
} from "@table-craft/desktop/renderer/state/datasources.js";
import { useTabs, type TabsStore } from "@table-craft/desktop/renderer/state/tabs.js";

export interface WiredStores {
  readonly datasources: DatasourcesStore;
  readonly consoles: ConsolesStore;
  readonly tabs: TabsStore;
  readonly catalog?: CatalogStore;
}

/**
 * What one store's change means for the others: a datasource whose engine went away leaves its
 * consoles disconnected and its catalog forgotten, and a deleted one takes its console tabs with it.
 */
export function wireStores({ datasources, consoles, tabs, catalog }: WiredStores): () => void {
  const offDetached = datasources.onDetached((id, error) => {
    consoles.getState().detach(id, error);
    catalog?.getState().clear(id);
  });
  const offRemoved = datasources.onRemoved((ids) => {
    for (const id of ids) {
      for (const consoleId of consolesOf(consoles.getState().consoles, id)) {
        tabs.getState().close(consoleId);
        consoles.getState().close(consoleId);
      }
    }
  });
  const offAttached = catalog === undefined ? () => undefined : followAttaches(datasources, catalog);
  return () => {
    offDetached();
    offRemoved();
    offAttached();
  };
}

/**
 * However a datasource got connected (a console, Connect, expanding its node), its tree opens on
 * the current namespace, described (plan 005, decision 7).
 */
function followAttaches(datasources: DatasourcesStore, catalog: CatalogStore): () => void {
  return datasources.subscribe((state, previous) => {
    for (const [id, connection] of Object.entries(state.connections)) {
      if (connection.status !== "connected" || previous.connections[id]?.status === "connected") continue;
      const datasource = state.datasources.find((candidate) => candidate.id === id);
      if (datasource === undefined) continue;
      if (!capabilitiesOf(state.plugins, datasource.pluginId).includes("schemaTree")) continue;
      void catalog.getState().expandDatasource(id);
    }
  });
}

/** Loads the list and plugins from main and follows main's broadcasts; returns the unsubscribe. */
export function installDatasourceSync(onFirstList: () => void): () => void {
  const store = useDatasources.getState();
  const offWired = wireStores({
    datasources: useDatasources,
    consoles: useConsoles,
    tabs: useTabs,
    catalog: useCatalog,
  });
  const offChanged = bridge().onDatasourcesChanged((list) => useDatasources.getState().applyList(list));
  const offExited = bridge().onEngineExited((exited) => useDatasources.getState().engineExited(exited));
  void (async () => {
    const plugins = await bridge().listPlugins();
    if (plugins.ok) store.setPlugins(plugins.value);
    const list = await bridge().listDatasources();
    if (list.ok) useDatasources.getState().applyList(list.value);
    onFirstList();
  })();
  return () => {
    offWired();
    offChanged();
    offExited();
  };
}
