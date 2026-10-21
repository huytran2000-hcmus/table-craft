import { join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { datasourceFromEnvironment } from "@table-craft/desktop/main/datasource.js";
import { createHostRegistry } from "@table-craft/desktop/main/hosts.js";
import { installApplicationMenu } from "@table-craft/desktop/main/menu.js";
import { CHANNELS } from "@table-craft/desktop/preload/bridge.js";

const APP_NAME = "table-craft";
const WINDOW_WIDTH = 1200;
const WINDOW_HEIGHT = 800;
const USER_PLUGINS_DIR = "plugins";
const USER_DATA = "userData";
const APP_DATA = "appData";
/** A test seam: a fresh profile per launch, so layout and plugins never leak between smoke runs. */
const USER_DATA_ENV = "TABLE_CRAFT_USER_DATA";

// Electron reads the name from the package.json beside the entry, and `dist/main` has none; without
// this, userData and so the user plugin root would be `Electron`.
app.setName(APP_NAME);
app.setPath(USER_DATA, process.env[USER_DATA_ENV] || join(app.getPath(APP_DATA), APP_NAME));

const datasource = datasourceFromEnvironment(process.env);

function distPath(relative: string): string {
  return join(import.meta.dirname, relative);
}

const hosts = createHostRegistry({
  entryFile: distPath("../engine/main.js"),
  pluginRoots: [distPath("../resources/plugins"), join(app.getPath(USER_DATA), USER_PLUGINS_DIR)],
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

ipcMain.on(CHANNELS.connectEngine, (event) => hosts.open(datasource, event.sender));

void app.whenReady().then(() => {
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
