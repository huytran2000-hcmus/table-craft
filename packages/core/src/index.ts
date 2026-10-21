export { CoreError, type CoreErrorCode } from "./errors.js";
export { loadPlugins, type LoadedPlugin, type PluginLoadResult, type UnavailablePlugin } from "./plugins/loader.js";
export {
  RESULT_FETCH_CAP,
  RESULT_WINDOW_ROWS,
  ResultStore,
  type ResultHandle,
  type ResultSummary,
  type ResultWindow,
} from "./results/store.js";
export { openSession } from "./sessions/open.js";
