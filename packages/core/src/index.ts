export { CatalogCache, type CachedCatalog } from "./catalog/cache.js";
export { CoreError, type CoreErrorCode } from "./errors.js";
export {
  discoverPlugins,
  loadPlugins,
  type AvailablePlugin,
  type LoadedPlugin,
  type PluginDiscovery,
  type PluginLoadResult,
  type UnavailablePlugin,
} from "./plugins/loader.js";
export { compareCodePoints, compareValues, inferredTypeClass, typeClass, type TypeClass } from "./results/compare.js";
export {
  RESULT_FETCH_ALL_CAP,
  RESULT_PAGE_ROWS,
  RESULT_WINDOW_ROWS,
  ResultStore,
  type FetchOptions,
  type ResultHandle,
  type ResultLimits,
  type ResultState,
  type ResultSummary,
  type ResultWindow,
  type SortDirection,
  type SortKey,
} from "./results/store.js";
export { loadedPlugin, openSession } from "./sessions/open.js";
export {
  EXTRACTOR_KINDS,
  SQL_INSERT_TABLE,
  extract,
  project,
  rowWriter,
  type ExtractOptions,
  type ExtractorKind,
  type RowWriter,
  type SqlDialect,
} from "./results/extract/index.js";
