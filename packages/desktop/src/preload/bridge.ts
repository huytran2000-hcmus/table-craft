/**
 * What main, preload and renderer agree on. Declarations only, so the sandboxed renderer can
 * import it without pulling in `electron` or zod. The types that mirror plugin-api are pinned to
 * their originals by `test/desktop/protocol.test.ts`.
 */
import type { UserThemeEntry } from "@table-craft/desktop/appearance/themes.js";
import type { Capability, ProbeResult } from "@table-craft/desktop/engine/protocol.js";
import type { LogRecord } from "@table-craft/desktop/log/record.js";
import type { Settings } from "@table-craft/desktop/settings/settings.js";

export const CHANNELS = {
  /** Main to preload: here is a fresh engine port for the datasource the payload names. */
  enginePort: "table-craft:engine-port",
  /** Main to preload: the user picked a native menu item; the payload is its action id. */
  invokeAction: "table-craft:invoke-action",
  /** Main to every window: the datasource list changed; the payload is a `DatasourceList`. */
  datasourcesChanged: "table-craft:datasources.changed",
  /** Main to every window: an engine host ended; the payload is an `EngineExited`. */
  engineExited: "table-craft:engine.exited",
  /** Main to a window: the user asked to close it or quit; answer with `answerClose`. */
  closeRequested: "table-craft:window.close-requested",
  /** Main to every window: settings were saved or the themes reread; the payload is a `SettingsChanged`. */
  settingsChanged: "table-craft:settings.changed",
  /** Main to a window: it entered or left full screen; the payload is its `WindowState`. */
  windowState: "table-craft:window.state-changed",
  /** Main to every window: records were written to the log; the payload is a `LogRecord[]`. */
  logAppended: "table-craft:log.appended",
} as const;

/** Renderer to main, through `ipcRenderer.invoke`; each answers with an `InvokeResult`. */
export const INVOKE_CHANNELS = {
  listDatasources: "table-craft:datasources.list",
  saveDatasource: "table-craft:datasources.save",
  deleteDatasource: "table-craft:datasources.delete",
  testDatasource: "table-craft:datasources.test",
  listPlugins: "table-craft:plugins.list",
  connectEngine: "table-craft:engine.connect",
  disconnectEngine: "table-craft:engine.disconnect",
  chooseFile: "table-craft:dialog.choose-file",
  saveFile: "table-craft:dialog.save-file",
  revealFile: "table-craft:shell.reveal-file",
  listConsoles: "table-craft:consoles.list",
  readConsole: "table-craft:consoles.read",
  writeConsole: "table-craft:consoles.write",
  deleteConsole: "table-craft:consoles.delete",
  historyRecord: "table-craft:history.record",
  historySearch: "table-craft:history.search",
  historyClear: "table-craft:history.clear",
  answerClose: "table-craft:window.answer-close",
  readSettings: "table-craft:settings.read",
  writeSettings: "table-craft:settings.write",
  reloadThemes: "table-craft:themes.reload",
  openThemesFolder: "table-craft:themes.open-folder",
  appInfo: "table-craft:app.info",
  popupMenu: "table-craft:menu.popup",
  windowState: "table-craft:window.state",
  relaunch: "table-craft:app.relaunch",
  logWrite: "table-craft:log.write",
  logRead: "table-craft:log.read",
  logReveal: "table-craft:log.reveal",
  exportDiagnostics: "table-craft:diagnostics.export",
} as const;

/** The `window.postMessage` kind preload uses to hand a port on; contextBridge cannot carry one. */
export const ENGINE_PORT_WINDOW_MESSAGE = "table-craft:engine-port";

export interface EnginePortWindowMessage {
  readonly kind: typeof ENGINE_PORT_WINDOW_MESSAGE;
  readonly datasourceId: string;
}

export const BRIDGE_KEY = "tableCraft";

/** How long a secret is kept (decision 020). */
export const SECRET_MODES = ["forever", "untilRestart", "never"] as const;
export type SecretMode = (typeof SECRET_MODES)[number];

/** The named tints a datasource can carry (decision 011); the values are design tokens. */
export const DATASOURCE_COLORS = ["red", "orange", "yellow", "green", "blue", "violet"] as const;
export type DatasourceColor = (typeof DATASOURCE_COLORS)[number];

/** Mirrors `ConnectionField` in plugin-api (decision 019). */
export interface ConnectionField {
  readonly key: string;
  readonly label: string;
  readonly kind: "text" | "number" | "password" | "file" | "select" | "checkbox";
  readonly default?: string | number | boolean | undefined;
  readonly required?: boolean | undefined;
  readonly placeholder?: string | undefined;
  readonly options?: readonly { readonly value: string; readonly label: string }[] | undefined;
  readonly group?: "general" | "advanced" | undefined;
  readonly secret?: boolean | undefined;
}

export type ConfigValue = string | number | boolean;

/** An installed plugin as the Data Sources dialog lists it; read from its manifest only. */
export interface PluginInfo {
  readonly id: string;
  readonly name: string;
  /** Null when the plugin can be used; otherwise why not, in a sentence. */
  readonly unavailableReason: string | null;
  readonly capabilities: readonly Capability[];
  readonly fields: readonly ConnectionField[];
  /** The manifest's SQL dialect for the editor, e.g. `postgresql`; null when the manifest is unreadable. */
  readonly highlight: string | null;
}

/** A datasource as `datasources.json` holds it: no secret value, ever (decision 010). */
export interface Datasource {
  readonly id: string;
  readonly name: string;
  readonly pluginId: string;
  /** A `/`-separated folder path, such as `Docker/Main`; null at the top level. */
  readonly folder: string | null;
  readonly color: DatasourceColor | null;
  readonly readOnly: boolean;
  readonly comment: string;
  /** The non-secret connection fields, by key. */
  readonly config: Readonly<Record<string, ConfigValue>>;
  /** How each secret field is kept, by key. */
  readonly secretModes: Readonly<Record<string, SecretMode>>;
}

/** What the renderer sees of a datasource: its record, and which secrets have a stored value. */
export interface DatasourceView extends Datasource {
  /** Secret keys with a value main can use without asking; never the values themselves. */
  readonly storedSecrets: readonly string[];
  /** From `TABLE_CRAFT_DATASOURCE` (decision 018): never written to disk, and not editable. */
  readonly ephemeral: boolean;
}

export interface DatasourceList {
  readonly datasources: readonly DatasourceView[];
  /** Set once when `datasources.json` could not be read and was backed up. */
  readonly warning: string | null;
  /** Whether Forever can be offered; when not, why (decision 020). */
  readonly encryption: { readonly available: boolean; readonly reason: string | null };
}

/** What a secret field asks main to do on save. A blank field on edit is `keep`. */
export type SecretChange =
  { readonly action: "keep" } | { readonly action: "set"; readonly value: string } | { readonly action: "clear" };

/** A datasource from the dialog; `id` is absent for a new one. */
export type DatasourceDraft = Omit<Datasource, "id"> & { readonly id?: string | undefined };

export interface SaveDatasourceRequest {
  readonly datasource: DatasourceDraft;
  readonly secrets: Readonly<Record<string, SecretChange>>;
}

export type ConnectResult =
  | { readonly status: "connected" }
  /** Secrets kept `never`, or lost from the keychain, that the user must type to connect now. */
  | { readonly status: "needsSecrets"; readonly keys: readonly string[] }
  | { readonly status: "failed"; readonly message: string; readonly hint: string };

export interface EngineExited {
  readonly datasourceId: string;
  readonly code: number;
  /** True when main asked it to stop or it closed its last port; false when it crashed. */
  readonly clean: boolean;
}

/** Mirrors core's `HISTORY_OUTCOMES` and `HISTORY_SOURCES` (decision 030). */
export const HISTORY_OUTCOMES = ["success", "error", "cancelled"] as const;
export type HistoryOutcome = (typeof HISTORY_OUTCOMES)[number];
export const HISTORY_SOURCES = ["console", "table"] as const;
export type HistorySource = (typeof HISTORY_SOURCES)[number];

/** Mirrors core's `HistoryEntry`: one statement run, as the renderer saw it end. */
export interface HistoryEntry {
  readonly datasourceId: string;
  readonly sql: string;
  /** Epoch milliseconds. */
  readonly startedAt: number;
  readonly durationMs: number;
  readonly outcome: HistoryOutcome;
  /** Rows returned for a result set, rows affected otherwise; null when unknown. */
  readonly rowCount: number | null;
  /** The error's message for a failure. */
  readonly message: string | null;
  readonly source: HistorySource;
  /** The values it was bound with, by parameter name; absent or null when none. */
  readonly parameters?: Readonly<Record<string, string | null>> | null;
}

/** Mirrors core's `HistoryStatement`: every run of one exact text, described by its newest. */
export interface HistoryStatement {
  readonly sql: string;
  readonly lastStartedAt: number;
  readonly lastDurationMs: number;
  readonly lastOutcome: HistoryOutcome;
  readonly lastRowCount: number | null;
  readonly lastMessage: string | null;
  readonly lastParameters: Readonly<Record<string, string | null>> | null;
  readonly runs: number;
}

/** The saved settings and the user themes main read beside them (decision 032). */
export interface SettingsChanged {
  readonly settings: Settings;
  readonly themes: readonly UserThemeEntry[];
}

export interface SettingsSnapshot extends SettingsChanged {
  /** Why `settings.json` was set aside at launch, for a one-time notice; null when it read cleanly. */
  readonly warning: string | null;
}

/** A failure main can explain; anything else is a bug. */
export interface BridgeFailure {
  readonly message: string;
  readonly hint: string;
}

export type InvokeResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: BridgeFailure };

/** What Help → About shows (plan 014 decision 9); `version` is `0.0.0` in development. */
export interface AppInfo {
  readonly name: string;
  readonly version: string;
  readonly electron: string;
  readonly chromium: string;
}

/** The window's frame (decision 034), fixed at creation, and whether it is full screen now. */
export interface WindowState {
  readonly fullScreen: boolean;
  /** The main toolbar is the title bar; false when "Use system title bar" was on at creation. */
  readonly customTitleBar: boolean;
}

/** A point in the window's content, in CSS pixels. */
export interface MenuPoint {
  readonly x: number;
  readonly y: number;
}

export interface TableCraftBridge {
  listDatasources(): Promise<InvokeResult<DatasourceList>>;
  saveDatasource(request: SaveDatasourceRequest): Promise<InvokeResult<DatasourceView>>;
  deleteDatasource(id: string): Promise<InvokeResult<null>>;
  /** Test Connection: a throwaway engine connects once; stored secrets are merged in main. */
  testDatasource(request: SaveDatasourceRequest): Promise<InvokeResult<ProbeResult>>;
  listPlugins(): Promise<InvokeResult<readonly PluginInfo[]>>;
  /**
   * Starts or reuses the datasource's engine. On `connected`, the port arrives as a window
   * message of kind `ENGINE_PORT_WINDOW_MESSAGE` naming the datasource. `secrets` carries what
   * the user typed after `needsSecrets`.
   */
  connectEngine(datasourceId: string, secrets?: Readonly<Record<string, string>>): Promise<InvokeResult<ConnectResult>>;
  /** Stops the datasource's engine; its sessions close and its ports go dead. */
  disconnectEngine(datasourceId: string): Promise<InvokeResult<null>>;
  /** The native open dialog, for a `file` connection field; null when cancelled. */
  chooseFile(title: string): Promise<InvokeResult<string | null>>;
  /** The native save dialog, for an export; the chosen absolute path, or null when cancelled. */
  saveFile(title: string, defaultName: string): Promise<InvokeResult<string | null>>;
  /** Shows an absolute path selected in the file manager: an export's file (decision 040). */
  revealFile(path: string): Promise<InvokeResult<null>>;
  /** The console names saved for the datasource, sorted (plan 006). */
  listConsoles(datasourceId: string): Promise<InvokeResult<readonly string[]>>;
  /** A saved console's text; null when none of that name is saved. */
  readConsole(datasourceId: string, name: string): Promise<InvokeResult<string | null>>;
  writeConsole(datasourceId: string, name: string, text: string): Promise<InvokeResult<null>>;
  deleteConsole(datasourceId: string, name: string): Promise<InvokeResult<null>>;
  /** Appends one run to the datasource's query history (decision 030). */
  historyRecord(entry: HistoryEntry): Promise<InvokeResult<null>>;
  /** The datasource's distinct statements containing `query`, case-insensitively, newest first. */
  historySearch(datasourceId: string, query: string): Promise<InvokeResult<readonly HistoryStatement[]>>;
  historyClear(datasourceId: string): Promise<InvokeResult<null>>;
  onDatasourcesChanged(listener: (list: DatasourceList) => void): () => void;
  onEngineExited(listener: (exited: EngineExited) => void): () => void;
  /** Calls `listener` with the action id of each native menu item picked; returns the unsubscribe. */
  onInvokeAction(listener: (actionId: string) => void): () => void;
  /** Main holds a close or quit until `answerClose`; returns the unsubscribe. */
  onCloseRequested(listener: () => void): () => void;
  /** Lets the held close go ahead, or keeps the window open. */
  answerClose(proceed: boolean): Promise<InvokeResult<null>>;
  readSettings(): Promise<InvokeResult<SettingsSnapshot>>;
  appInfo(): Promise<InvokeResult<AppInfo>>;
  /** Saves the whole document; every window, this one included, hears it on `onSettingsChanged`. */
  writeSettings(settings: Settings): Promise<InvokeResult<null>>;
  /** Rereads `<userData>/themes/`; every window hears the list on `onSettingsChanged`. */
  reloadThemes(): Promise<InvokeResult<null>>;
  /** Creates the themes folder if missing and opens it in the file manager. */
  openThemesFolder(): Promise<InvokeResult<null>>;
  onSettingsChanged(listener: (changed: SettingsChanged) => void): () => void;
  /** Pops the application menu at `point` in this window (Windows and Linux, decision 034). */
  popupMenu(point: MenuPoint): Promise<InvokeResult<null>>;
  windowState(): Promise<InvokeResult<WindowState>>;
  onWindowState(listener: (state: WindowState) => void): () => void;
  /** Quits through the close guard (decision 024) and starts the app again; a refused close stays. */
  relaunch(): Promise<InvokeResult<null>>;
  /** Hands main a batch of the renderer's records; main sets their process and filters by level (plan 017). */
  logWrite(records: readonly LogRecord[]): Promise<InvokeResult<null>>;
  /** The newest records across the log files, newest first. */
  logRead(): Promise<InvokeResult<readonly LogRecord[]>>;
  /** Shows the log file in Finder or Explorer. */
  logReveal(): Promise<InvokeResult<null>>;
  onLogAppended(listener: (records: readonly LogRecord[]) => void): () => void;
  /** Asks for a path, then writes the diagnostics zip there; the path written, or null when cancelled. */
  exportDiagnostics(): Promise<InvokeResult<string | null>>;
}
