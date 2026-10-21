import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  MessageChannelMain,
  safeStorage,
  utilityProcess,
  type OpenDialogOptions,
  type UtilityProcess,
  type WebContents,
} from "electron";
import { datasourceFromEnvironment } from "@table-craft/desktop/main/datasource.js";
import { createDatasourceStore } from "@table-craft/desktop/main/datasources.js";
import type { FileSystem } from "@table-craft/desktop/main/files.js";
import { createHostRegistry, type EngineProcess } from "@table-craft/desktop/main/hosts.js";
import { registerIpc } from "@table-craft/desktop/main/ipc.js";
import { installApplicationMenu } from "@table-craft/desktop/main/menu.js";
import { listPlugins } from "@table-craft/desktop/main/plugins.js";
import { createSecretStore, type Cipher } from "@table-craft/desktop/main/secrets.js";
import { createDatasourceService } from "@table-craft/desktop/main/service.js";
import { ENGINE_PORT_MESSAGE } from "@table-craft/desktop/engine/protocol.js";
import { CHANNELS, type DatasourceList, type EngineExited } from "@table-craft/desktop/preload/bridge.js";

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

// Electron reads the name from the package.json beside the entry, and `dist/main` has none; without
// this, userData and so the user plugin root would be `Electron`.
app.setName(APP_NAME);
app.setPath(USER_DATA, process.env[USER_DATA_ENV] || join(app.getPath(APP_DATA), APP_NAME));

const ephemeral = datasourceFromEnvironment(process.env);

function distPath(relative: string): string {
  return join(import.meta.dirname, relative);
}

const files: FileSystem = {
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
};

const cipher: Cipher = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptString(plain).toString(CIPHER_ENCODING),
  decrypt: (cipherText) => safeStorage.decryptString(Buffer.from(cipherText, CIPHER_ENCODING)),
};

function broadcast(channel: string, payload: DatasourceList | EngineExited): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload);
}

const entryFile = distPath("../engine/main.js");
const pluginRoots = [distPath("../resources/plugins"), join(app.getPath(USER_DATA), USER_PLUGINS_DIR)];

const hosts = createHostRegistry<WebContents>({
  pluginRoots,
  dependencies: {
    fork: (serviceName): EngineProcess => {
      const host: UtilityProcess = utilityProcess.fork(entryFile, [], { serviceName, stdio: HOST_STDIO });
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

function createWindow(): void {
  const window = new BrowserWindow({
    title: APP_NAME,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    show: false,
    webPreferences: {
      preload: distPath("../preload/preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.once("ready-to-show", () => window.show());
  void window.loadFile(distPath("../renderer/index.html"));
}

async function chooseFile(contents: WebContents, title: string): Promise<string | null> {
  const parent = BrowserWindow.fromWebContents(contents);
  const options: OpenDialogOptions = { title, properties: ["openFile", "promptToCreate"] };
  const picked = parent === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(parent, options);
  return picked.canceled ? null : (picked.filePaths[0] ?? null);
}

void app.whenReady().then(async () => {
  const directory = app.getPath(USER_DATA);
  // safeStorage answers only once the app is ready.
  const service = await createDatasourceService<WebContents>({
    store: createDatasourceStore({ directory, files }),
    secrets: await createSecretStore({ directory, files, cipher }),
    hosts,
    plugins: await listPlugins(pluginRoots),
    ephemeral,
    newId: randomUUID,
    onChanged: (list) => broadcast(CHANNELS.datasourcesChanged, list),
  });
  registerIpc<WebContents>(ipcMain, {
    service,
    chooseFile,
    log: (message, cause) => console.error(`table-craft: ${message}`, cause),
  });
  installApplicationMenu(() => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => hosts.closeAll());
