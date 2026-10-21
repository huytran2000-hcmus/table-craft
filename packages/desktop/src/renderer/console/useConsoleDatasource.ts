import type { DatasourceView } from "@table-craft/desktop/preload/bridge.js";
import { useConsoles } from "@table-craft/desktop/renderer/state/consoles.js";
import { datasourceById, useDatasources } from "@table-craft/desktop/renderer/state/datasources.js";

/** The datasource a console runs on; undefined once it is deleted, until its tab closes. */
export function useConsoleDatasource(consoleId: string): DatasourceView | undefined {
  const datasourceId = useConsoles((state) => state.consoles[consoleId]?.datasourceId);
  return useDatasources((state) => datasourceById(state, datasourceId));
}
