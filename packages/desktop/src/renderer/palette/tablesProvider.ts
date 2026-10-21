import type { DatasourceView } from "@table-craft/desktop/preload/bridge.js";
import type { RevealArgs } from "@table-craft/desktop/renderer/actions/explorerActions.js";
import { score } from "@table-craft/desktop/renderer/model/fuzzy.js";
import { loadedRelations, type DatasourceCatalog } from "@table-craft/desktop/renderer/model/explorerTree.js";
import type { SearchItem, SearchProvider } from "@table-craft/desktop/renderer/model/palette.js";

export const TABLES_PROVIDER_ID = "tables";
const TABLE_KEY_PREFIX = "table:";
const PATH_SEPARATOR = " › ";

export interface TablesSource {
  readonly catalogs: () => Readonly<Record<string, DatasourceCatalog>>;
  readonly datasources: () => readonly DatasourceView[];
  /** Runs the reveal action; the provider never touches a store itself (decision 015). */
  readonly reveal: (args: RevealArgs) => void;
}

/**
 * Tables and views of every catalog loaded so far, titled by name with `datasource › path` as
 * detail. It never introspects: a schema nobody expanded is not searched.
 */
export function tablesProvider(source: TablesSource): SearchProvider {
  return {
    id: TABLES_PROVIDER_ID,
    title: "Tables",
    search(query) {
      const names = new Map(source.datasources().map((datasource) => [datasource.id, datasource.name]));
      return loadedRelations(source.catalogs()).flatMap(({ datasourceId, path, relation }): SearchItem[] => {
        const matched = score(query, relation.name);
        const datasourceName = names.get(datasourceId);
        if (matched === null || datasourceName === undefined) return [];
        return [
          {
            key: `${TABLE_KEY_PREFIX}${JSON.stringify([datasourceId, path, relation.name])}`,
            title: relation.name,
            detail: [datasourceName, ...path].join(PATH_SEPARATOR),
            enabled: true,
            score: matched,
            run: () => source.reveal({ datasourceId, path, name: relation.name, kind: relation.kind }),
          },
        ];
      });
    },
  };
}
