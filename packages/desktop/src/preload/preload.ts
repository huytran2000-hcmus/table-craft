import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  BRIDGE_KEY,
  CHANNELS,
  ENGINE_PORT_WINDOW_MESSAGE,
  INVOKE_CHANNELS,
  type DatasourceList,
  type EnginePortWindowMessage,
  type EngineExited,
  type InvokeResult,
  type TableCraftBridge,
} from "@table-craft/desktop/preload/bridge.js";

/** Structural, because this program has no DOM lib and preload is the one place that needs it. */
interface TransferringWindow {
  postMessage(message: unknown, targetOrigin: string, transfer: readonly unknown[]): void;
}

interface PortCarryingEvent {
  readonly ports: readonly unknown[];
}

const WINDOW_TARGET_ORIGIN = "*";

ipcRenderer.on(CHANNELS.enginePort, (event: IpcRendererEvent, datasourceId: unknown) => {
  const port = (event as unknown as PortCarryingEvent).ports[0];
  if (port === undefined || typeof datasourceId !== "string") return;
  const message: EnginePortWindowMessage = { kind: ENGINE_PORT_WINDOW_MESSAGE, datasourceId };
  (globalThis as unknown as TransferringWindow).postMessage(message, WINDOW_TARGET_ORIGIN, [port]);
});

function invoke<T>(channel: string, ...args: unknown[]): Promise<InvokeResult<T>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<InvokeResult<T>>;
}

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const relay = (_event: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, relay);
  return () => ipcRenderer.off(channel, relay);
}

const bridge: TableCraftBridge = {
  listDatasources: () => invoke(INVOKE_CHANNELS.listDatasources),
  saveDatasource: (request) => invoke(INVOKE_CHANNELS.saveDatasource, request),
  deleteDatasource: (id) => invoke(INVOKE_CHANNELS.deleteDatasource, { id }),
  testDatasource: (request) => invoke(INVOKE_CHANNELS.testDatasource, request),
  listPlugins: () => invoke(INVOKE_CHANNELS.listPlugins),
  connectEngine: (datasourceId, secrets) => invoke(INVOKE_CHANNELS.connectEngine, { datasourceId, secrets }),
  disconnectEngine: (datasourceId) => invoke(INVOKE_CHANNELS.disconnectEngine, { datasourceId }),
  chooseFile: (title) => invoke(INVOKE_CHANNELS.chooseFile, { title }),
  listConsoles: (datasourceId) => invoke(INVOKE_CHANNELS.listConsoles, { datasourceId }),
  readConsole: (datasourceId, name) => invoke(INVOKE_CHANNELS.readConsole, { datasourceId, name }),
  writeConsole: (datasourceId, name, text) => invoke(INVOKE_CHANNELS.writeConsole, { datasourceId, name, text }),
  deleteConsole: (datasourceId, name) => invoke(INVOKE_CHANNELS.deleteConsole, { datasourceId, name }),
  onDatasourcesChanged: (listener) => subscribe<DatasourceList>(CHANNELS.datasourcesChanged, listener),
  onEngineExited: (listener) => subscribe<EngineExited>(CHANNELS.engineExited, listener),
  onInvokeAction(listener) {
    return subscribe<unknown>(CHANNELS.invokeAction, (actionId) => {
      if (typeof actionId === "string") listener(actionId);
    });
  },
  onCloseRequested: (listener) => subscribe<unknown>(CHANNELS.closeRequested, () => listener()),
  answerClose: (proceed) => invoke(INVOKE_CHANNELS.answerClose, { proceed }),
};

contextBridge.exposeInMainWorld(BRIDGE_KEY, bridge);
