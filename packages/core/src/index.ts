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
export {
  RESULT_FETCH_CAP,
  RESULT_WINDOW_ROWS,
  ResultStore,
  type ResultHandle,
  type ResultSummary,
  type ResultWindow,
} from "./results/store.js";
export { loadedPlugin, openSession } from "./sessions/open.js";
