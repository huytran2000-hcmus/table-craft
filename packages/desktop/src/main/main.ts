import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  MessageChannelMain,
  nativeTheme,
  safeStorage,
  shell,
  utilityProcess,
  type OpenDialogOptions,
  type SaveDialogOptions,
  type UtilityProcess,
  type WebContents,
} from "electron";
import { openQueryHistory } from "@table-craft/core";
import { createCloseGuard } from "@table-craft/desktop/main/closeGuard.js";
import { createConsoleFiles, type DirectoryFileSystem } from "@table-craft/desktop/main/consoleFiles.js";
import { datasourceFromEnvironment } from "@table-craft/desktop/main/datasource.js";
import { createDatasourceStore } from "@table-craft/desktop/main/datasources.js";
import { createHostRegistry, type EngineProcess } from "@table-craft/desktop/main/hosts.js";
import { registerIpc } from "@table-craft/desktop/main/ipc.js";
import { installApplicationMenu } from "@table-craft/desktop/main/menu.js";
import { appPaths } from "@table-craft/desktop/main/paths.js";
import { listPlugins } from "@table-craft/desktop/main/plugins.js";
import { createSecretStore, type Cipher } from "@table-craft/desktop/main/secrets.js";
import { createDatasourceService } from "@table-craft/desktop/main/service.js";
import {
  createSettingsService,
  createSettingsStore,
  type SettingsService,
} from "@table-craft/desktop/main/settings.js";
import { createThemeFolder } from "@table-craft/desktop/main/themes.js";
import { resolveTheme, type Theme } from "@table-craft/desktop/appearance/themes.js";
import { ENGINE_PORT_MESSAGE } from "@table-craft/desktop/engine/protocol.js";
import {
  CHANNELS,
  type AppInfo,
  type DatasourceList,
  type EngineExited,
  type SettingsChanged,
} from "@table-craft/desktop/preload/bridge.js";

const APP_NAME = "table-craft";
const WINDOW_WIDTH = 1200;
const WINDOW_HEIGHT = 800;
const USER_PLUGINS_DIR = "plugins";
const USER_DATA = "userData";
const APP_DATA = "appData";
/** A test seam: a fresh profile per launch, so layout, datasources and plugins never leak between smoke runs. */
const USER_DATA_ENV = "TABLE_CRAFT_USER_DATA";
/** stdout and stderr inherit the app's, so engine output reaches the terminal that launched it. */
const HOST_STDIO = "inherit";
const UTF8 = "utf8";
const MISSING_FILE = "ENOENT";
const CIPHER_ENCODING = "base64";
/** Decision 010's place for query history (decision 030). */
const HISTORY_FILE = "history.sqlite";
/**
 * Unpackaged, `app.getVersion()` is Electron's own, because `dist/main` has no package.json; a
 * packaged build carries the version from git (decision 033).
 */
const DEVELOPMENT_VERSION = "0.0.0";
const MAC_PLATFORM = "darwin";

// Electron reads the name from the package.json beside the entry, and `dist/main` has none; without
// this, userData and so the user plugin root would be `Electron`.
app.setName(APP_NAME);
app.setPath(USER_DATA, process.env[USER_DATA_ENV] || join(app.getPath(APP_DATA), APP_NAME));

const ephemeral = datasourceFromEnvironment(process.env);

const paths = appPaths({
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  distDirectory: dirname(import.meta.dirname),
});
const appVersion = app.isPackaged ? app.getVersion() : DEVELOPMENT_VERSION;
const appInfo: AppInfo = {
  name: APP_NAME,
  version: appVersion,
  electron: process.versions.electron,
  chromium: process.versions.chrome,
};

const files: DirectoryFileSystem = {
  async readText(path) {
    try {
      return await readFile(path, UTF8);
    } catch (error) {
      if ((error as { code?: unknown }).code === MISSING_FILE) return null;
      throw error;
    }
  },
  writeText: (path, text) => writeFile(path, text, UTF8),
  rename,
  async listNames(path) {
    try {
      return await readdir(path);
    } catch (error) {
      if ((error as { code?: unknown }).code === MISSING_FILE) return [];
      throw error;
    }
  },
  makeDirectory: async (path) => {
    await mkdir(path, { recursive: true });
  },
  remove: (path) => rm(path, { force: true }),
  removeDirectory: (path) => rm(path, { recursive: true, force: true }),
};

const cipher: Cipher = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptString(plain).toString(CIPHER_ENCODING),
  decrypt: (cipherText) => safeStorage.decryptString(Buffer.from(cipherText, CIPHER_ENCODING)),
};

function broadcast(channel: string, payload: DatasourceList | EngineExited | SettingsChanged): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload);
}

const pluginRoots = [paths.builtInPlugins, join(app.getPath(USER_DATA), USER_PLUGINS_DIR)];

const hosts = createHostRegistry<WebContents>({
  pluginRoots,
  dependencies: {
    fork: (serviceName): EngineProcess => {
      const host: UtilityProcess = utilityProcess.fork(paths.engineEntry, [], { serviceName, stdio: HOST_STDIO });
      return host;
    },
    connectPort(host, datasourceId, contents) {
      const channel = new MessageChannelMain();
      (host as UtilityProcess).postMessage({ kind: ENGINE_PORT_MESSAGE }, [channel.port1]);
      contents.postMessage(CHANNELS.enginePort, datasourceId, [channel.port2]);
    },
    setTimeout: (run, ms) => setTimeout(run, ms),
    clearTimeout: (timer) => clearTimeout(timer as NodeJS.Timeout),
  },
  onExit: (datasourceId, code, clean) => broadcast(CHANNELS.engineExited, { datasourceId, code, clean }),
});

const closeGuard = createCloseGuard<BrowserWindow>({ quit: () => app.quit() });

/**
 * The theme the settings name, made concrete, after pointing `nativeTheme` at its scheme so menus,
 * dialogs and the renderer's `prefers-color-scheme` agree (plan 013 decision 8). Only a `"system"`
 * choice reads the OS, which is why `themeSource` is set first.
 */
function applyNativeTheme(settings: SettingsService): Theme {
  const { settings: current, themes } = settings.snapshot();
  const choice = current.appearance.theme;
  // Assigning `themeSource` emits `updated`, which calls back here; only a real change assigns.
  const pointAt = (source: typeof nativeTheme.themeSource) => {
    if (nativeTheme.themeSource !== source) nativeTheme.themeSource = source;
  };
  if (choice === "system") pointAt("system");
  const system = {
    prefersDark: nativeTheme.shouldUseDarkColors,
    prefersMoreContrast: nativeTheme.shouldUseHighContrastColors,
  };
  const { theme } = resolveTheme(choice, system, themes);
  if (choice !== "system") pointAt(theme.colorScheme);
  for (const window of BrowserWindow.getAllWindows()) window.setBackgroundColor(theme.colors.canvas);
  return theme;
}

function createWindow(settings: SettingsService): void {
  const window = new BrowserWindow({
    title: APP_NAME,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    show: false,
    // The first frame, before the renderer's bundle runs, is already the theme's canvas.
    backgroundColor: applyNativeTheme(settings).colors.canvas,
    // macOS takes the window's icon from the app bundle, or the dock in development.
    ...(process.platform === MAC_PLATFORM ? {} : { icon: paths.icon }),
    webPreferences: {
      preload: paths.preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.once("ready-to-show", () => window.show());
  closeGuard.guard(window);
  void window.loadFile(paths.rendererIndex);
}

async function saveFile(contents: WebContents, title: string, defaultName: string): Promise<string | null> {
  const parent = BrowserWindow.fromWebContents(contents);
  const options: SaveDialogOptions = { title, defaultPath: defaultName, properties: ["createDirectory"] };
  const picked = parent === null ? await dialog.showSaveDialog(options) : await dialog.showSaveDialog(parent, options);
  return picked.canceled || picked.filePath === "" ? null : picked.filePath;
}

async function chooseFile(contents: WebContents, title: string): Promise<string | null> {
  const parent = BrowserWindow.fromWebContents(contents);
  const options: OpenDialogOptions = { title, properties: ["openFile", "promptToCreate"] };
  const picked = parent === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(parent, options);
  return picked.canceled ? null : (picked.filePaths[0] ?? null);
}

void app.whenReady().then(async () => {
  app.setAboutPanelOptions({ applicationName: APP_NAME, applicationVersion: appVersion });
  if (process.platform === MAC_PLATFORM && !app.isPackaged) app.dock?.setIcon(paths.icon);
  const directory = app.getPath(USER_DATA);
  const consoles = createConsoleFiles({ directory, files });
  await mkdir(directory, { recursive: true });
  const history = openQueryHistory(join(directory, HISTORY_FILE));
  if (history.recoveredFrom !== null) {
    console.error(`table-craft: ${HISTORY_FILE} could not be read; it was moved to ${history.recoveredFrom}`);
  }
  app.on("will-quit", () => history.close());
  // safeStorage answers only once the app is ready.
  const service = await createDatasourceService<WebContents>({
    store: createDatasourceStore({ directory, files }),
    secrets: await createSecretStore({ directory, files, cipher }),
    hosts,
    plugins: await listPlugins(pluginRoots),
    ephemeral,
    newId: randomUUID,
    consoles,
    history,
    onChanged: (list) => broadcast(CHANNELS.datasourcesChanged, list),
  });
  const themes = createThemeFolder({ directory, files });
  const settings: SettingsService = await createSettingsService({
    store: createSettingsStore({ directory, files }),
    themes,
    onChanged(changed) {
      applyNativeTheme(settings);
      broadcast(CHANNELS.settingsChanged, changed);
    },
  });
  if (settings.snapshot().warning !== null) console.error(`table-craft: ${String(settings.snapshot().warning)}`);
  nativeTheme.on("updated", () => {
    if (settings.snapshot().settings.appearance.theme === "system") applyNativeTheme(settings);
  });
  registerIpc<WebContents>(ipcMain, {
    service,
    consoles,
    history,
    settings,
    async openThemesFolder() {
      await files.makeDirectory(themes.path);
      const failure = await shell.openPath(themes.path);
      if (failure !== "") throw new Error(`${themes.path} could not be opened: ${failure}`);
    },
    chooseFile,
    saveFile,
    answerClose(sender, proceed) {
      const window = BrowserWindow.fromWebContents(sender);
      if (window !== null) closeGuard.answer(window, proceed);
    },
    appInfo: () => appInfo,
    log: (message, cause) => console.error(`table-craft: ${message}`, cause),
  });
  installApplicationMenu(() => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null);
  createWindow(settings);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(settings);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== MAC_PLATFORM) app.quit();
});

app.on("before-quit", () => closeGuard.beforeQuit());

app.on("will-quit", () => hosts.closeAll());
