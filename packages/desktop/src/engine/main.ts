import type { MessagePortMain, ParentPort } from "electron";
import { loadPlugins, type PluginLoadResult } from "@table-craft/core";
import {
  createEngine,
  probeDatasource,
  type Engine,
  type EngineConnection,
} from "@table-craft/desktop/engine/engine.js";
import { createLifetime } from "@table-craft/desktop/engine/lifetime.js";
import {
  ENGINE_BOOT_MESSAGE,
  ENGINE_PORT_MESSAGE,
  ENGINE_PROBED_MESSAGE,
  ENGINE_SHUTDOWN_MESSAGE,
  type EngineBoot,
  type EngineProbed,
} from "@table-craft/desktop/engine/protocol.js";

interface UtilityProcess {
  readonly parentPort: ParentPort;
}

process.setSourceMapsEnabled(true);

const parentPort = (process as unknown as UtilityProcess).parentPort;
let booted: Promise<EngineConnectionFactory> | null = null;
let engine: Engine | null = null;
const connections = new Set<Promise<EngineConnection>>();

type EngineConnectionFactory = () => EngineConnection;

async function plugins(message: EngineBoot): Promise<PluginLoadResult[]> {
  const loaded = await loadPlugins(message.pluginRoots);
  for (const entry of loaded) {
    if (entry.status === "unavailable") console.warn(`plugin unavailable at ${entry.directory}: ${entry.reason}`);
  }
  return loaded;
}

async function exitAfterClosing(): Promise<never> {
  const open = [...connections];
  connections.clear();
  await Promise.allSettled(open.map(async (connection) => (await connection).close()));
  await engine?.close();
  process.exit(0);
}

const lifetime = createLifetime(() => void exitAfterClosing());

async function serve(message: EngineBoot): Promise<EngineConnectionFactory> {
  const served = createEngine({ datasource: message.datasource, plugins: await plugins(message) });
  engine = served;
  return () => served.connect();
}

async function probe(message: EngineBoot): Promise<never> {
  const result = await probeDatasource({ datasource: message.datasource, plugins: await plugins(message) });
  const probed: EngineProbed = { kind: ENGINE_PROBED_MESSAGE, result };
  parentPort.postMessage(probed);
  process.exit(0);
}

function attach(port: MessagePortMain, ready: Promise<EngineConnectionFactory>): void {
  const connection = ready.then((connect) => connect());
  connections.add(connection);
  lifetime.attached();
  port.on("message", (event) => {
    void connection.then((open) => open.handle(event.data)).then((response) => port.postMessage(response));
  });
  port.on("close", () => {
    if (!connections.delete(connection)) return;
    void connection
      .then((open) => open.close())
      .finally(() => {
        lifetime.detached();
      });
  });
  port.start();
}

parentPort.on("message", (event) => {
  const data = event.data as { kind?: unknown } | null;
  if (data?.kind === ENGINE_BOOT_MESSAGE && booted === null) {
    const message = data as EngineBoot;
    if (message.mode === "probe") {
      void probe(message);
      return;
    }
    booted = serve(message);
    return;
  }
  if (data?.kind === ENGINE_SHUTDOWN_MESSAGE) {
    void exitAfterClosing();
    return;
  }
  if (data?.kind !== ENGINE_PORT_MESSAGE || booted === null) return;
  for (const port of event.ports) attach(port, booted);
});
