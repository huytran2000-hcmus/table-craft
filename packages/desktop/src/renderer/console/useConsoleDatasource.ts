import type { DatasourceView } from "@table-craft/desktop/preload/bridge.js";
import { useConsoles } from "@table-craft/desktop/renderer/state/consoles.js";
import { datasourceById, useDatasources } from "@table-craft/desktop/renderer/state/datasources.js";
import { useTables } from "@table-craft/desktop/renderer/state/tables.js";

/** The datasource a console or table tab works on; undefined once it is deleted, until its tab closes. */
export function useConsoleDatasource(tabId: string): DatasourceView | undefined {
  const consoleDatasource = useConsoles((state) => state.consoles[tabId]?.datasourceId);
  const tableDatasource = useTables((state) => state.tables[tabId]?.datasourceId);
  return useDatasources((state) => datasourceById(state, consoleDatasource ?? tableDatasource));
}
