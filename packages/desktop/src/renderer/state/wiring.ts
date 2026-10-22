import { bridge } from "@table-craft/desktop/renderer/bridge.js";
import { useCatalog, type CatalogStore } from "@table-craft/desktop/renderer/state/catalog.js";
import { consolesOf, useConsoles, type ConsolesStore } from "@table-craft/desktop/renderer/state/consoles.js";
import { ddlsOf, followRedescribes, useDdl, type DdlStore } from "@table-craft/desktop/renderer/state/ddl.js";
import {
  capabilitiesOf,
  useDatasources,
  type DatasourcesStore,
} from "@table-craft/desktop/renderer/state/datasources.js";
import { tablesOf, useTables, type TablesStore } from "@table-craft/desktop/renderer/state/tables.js";
import { useTabs, type TabsStore } from "@table-craft/desktop/renderer/state/tabs.js";

export interface WiredStores {
  readonly datasources: DatasourcesStore;
  readonly consoles: ConsolesStore;
  readonly tabs: TabsStore;
  readonly catalog?: CatalogStore;
  readonly tables?: TablesStore;
  readonly ddl?: DdlStore;
}

/**
 * What one store's change means for the others: a datasource whose engine went away leaves its
 * consoles and tables disconnected and its catalog forgotten, a deleted one takes its tabs with it,
 * and a namespace described anew refreshes the DDL tabs showing its relations.
 */
export function wireStores({ datasources, consoles, tabs, catalog, tables, ddl }: WiredStores): () => void {
  const offDetached = datasources.onDetached((id, error) => {
    consoles.getState().detach(id, error);
    tables?.getState().detach(id, error);
    catalog?.getState().clear(id);
  });
  const offRemoved = datasources.onRemoved((ids) => {
    for (const id of ids) {
      for (const consoleId of consolesOf(consoles.getState().consoles, id)) {
        tabs.getState().close(consoleId);
        consoles.getState().close(consoleId);
      }
      for (const tableId of tables === undefined ? [] : tablesOf(tables.getState().tables, id)) {
        tabs.getState().close(tableId);
        tables?.getState().close(tableId);
      }
      for (const ddlId of ddl === undefined ? [] : ddlsOf(ddl.getState().ddls, id)) {
        tabs.getState().close(ddlId);
        ddl?.getState().close(ddlId);
      }
    }
  });
  const offAttached = catalog === undefined ? () => undefined : followAttaches(datasources, catalog);
  const offRedescribes = catalog === undefined || ddl === undefined ? () => undefined : followRedescribes(ddl, catalog);
  return () => {
    offDetached();
    offRemoved();
    offAttached();
    offRedescribes();
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
    tables: useTables,
    ddl: useDdl,
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
