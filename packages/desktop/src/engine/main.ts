import type { MessagePortMain, ParentPort } from "electron";
import { loadPlugins } from "@table-craft/core";
import { createEngine, type Engine } from "@table-craft/desktop/engine/engine.js";
import { ENGINE_BOOT_MESSAGE, ENGINE_PORT_MESSAGE, type EngineBoot } from "@table-craft/desktop/engine/protocol.js";

interface UtilityProcess {
  readonly parentPort: ParentPort;
}

process.setSourceMapsEnabled(true);

const parentPort = (process as unknown as UtilityProcess).parentPort;
let engine: Promise<Engine> | null = null;

async function boot(message: EngineBoot): Promise<Engine> {
  const plugins = await loadPlugins(message.pluginRoots);
  for (const entry of plugins) {
    if (entry.status === "unavailable") console.warn(`plugin unavailable at ${entry.directory}: ${entry.reason}`);
  }
  return createEngine({ datasource: message.datasource, plugins });
}

function attach(port: MessagePortMain, ready: Promise<Engine>): void {
  const connection = ready.then((started) => started.connect());
  port.on("message", (event) => {
    void connection.then((open) => open.handle(event.data)).then((response) => port.postMessage(response));
  });
  port.on("close", () => {
    void connection.then((open) => open.close());
  });
  port.start();
}

parentPort.on("message", (event) => {
  const data = event.data as { kind?: unknown } | null;
  if (data?.kind === ENGINE_BOOT_MESSAGE && engine === null) {
    engine = boot(data as EngineBoot);
    return;
  }
  if (data?.kind !== ENGINE_PORT_MESSAGE || engine === null) return;
  for (const port of event.ports) attach(port, engine);
});
