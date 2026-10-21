import { bridge } from "@table-craft/desktop/renderer/bridge.js";
import { consolesOf, useConsoles, type ConsolesStore } from "@table-craft/desktop/renderer/state/consoles.js";
import { useDatasources, type DatasourcesStore } from "@table-craft/desktop/renderer/state/datasources.js";
import { useTabs, type TabsStore } from "@table-craft/desktop/renderer/state/tabs.js";

export interface WiredStores {
  readonly datasources: DatasourcesStore;
  readonly consoles: ConsolesStore;
  readonly tabs: TabsStore;
}

/**
 * What one store's change means for the others: a datasource whose engine went away leaves its
 * consoles disconnected, and a deleted one takes its console tabs with it.
 */
export function wireStores({ datasources, consoles, tabs }: WiredStores): () => void {
  const offDetached = datasources.onDetached((id, error) => consoles.getState().detach(id, error));
  const offRemoved = datasources.onRemoved((ids) => {
    for (const id of ids) {
      for (const consoleId of consolesOf(consoles.getState().consoles, id)) {
        tabs.getState().close(consoleId);
        consoles.getState().close(consoleId);
      }
    }
  });
  return () => {
    offDetached();
    offRemoved();
  };
}

/** Loads the list and plugins from main and follows main's broadcasts; returns the unsubscribe. */
export function installDatasourceSync(onFirstList: () => void): () => void {
  const store = useDatasources.getState();
  const offWired = wireStores({ datasources: useDatasources, consoles: useConsoles, tabs: useTabs });
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
