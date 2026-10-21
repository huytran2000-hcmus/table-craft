import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  BRIDGE_KEY,
  CHANNELS,
  ENGINE_PORT_WINDOW_MESSAGE,
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

ipcRenderer.on(CHANNELS.enginePort, (event: IpcRendererEvent) => {
  const port = (event as unknown as PortCarryingEvent).ports[0];
  if (port === undefined) return;
  (globalThis as unknown as TransferringWindow).postMessage(
    { kind: ENGINE_PORT_WINDOW_MESSAGE },
    WINDOW_TARGET_ORIGIN,
    [port],
  );
});

const bridge: TableCraftBridge = {
  connectEngine: () => ipcRenderer.send(CHANNELS.connectEngine),
};

contextBridge.exposeInMainWorld(BRIDGE_KEY, bridge);
