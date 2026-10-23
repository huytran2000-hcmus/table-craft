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
  ENGINE_LOG_MESSAGE,
  ENGINE_PORT_MESSAGE,
  ENGINE_PROBED_MESSAGE,
  ENGINE_SHUTDOWN_MESSAGE,
  type EngineBoot,
  type EngineEvent,
  type EngineLog,
  type EngineProbed,
} from "@table-craft/desktop/engine/protocol.js";
import { createLogger } from "@table-craft/desktop/log/record.js";

interface UtilityProcess {
  readonly parentPort: ParentPort;
}

process.setSourceMapsEnabled(true);

const parentPort = (process as unknown as UtilityProcess).parentPort;
/** Main sets each record's process from the host it came from, so the engine never names itself. */
const log = createLogger({
  process: "engine",
  scope: "engine",
  sink: (record) => parentPort.postMessage({ kind: ENGINE_LOG_MESSAGE, record } satisfies EngineLog),
});

/** Node's own exit code for an uncaught exception; the engine still dies of one, it is only logged first. */
const UNCAUGHT_EXIT_CODE = 1;

function crash(msg: string, cause: unknown): void {
  log.error(msg, { err: cause });
  // A turn later, so the record posted above leaves the port before the process does.
  setImmediate(() => process.exit(UNCAUGHT_EXIT_CODE));
}

process.on("uncaughtException", (cause) => crash("uncaught exception", cause));
process.on("unhandledRejection", (cause) => crash("unhandled rejection", cause));
let booted: Promise<EngineConnectionFactory> | null = null;
let engine: Engine | null = null;
const connections = new Set<Promise<EngineConnection>>();

type EngineConnectionFactory = (emit: (event: EngineEvent) => void) => EngineConnection;

async function plugins(message: EngineBoot): Promise<PluginLoadResult[]> {
  const loaded = await loadPlugins(message.pluginRoots);
  const plugins = log.child("plugins");
  for (const entry of loaded) {
    const fields = {
      pluginId: entry.manifest?.id ?? null,
      version: entry.manifest?.version ?? null,
      directory: entry.directory,
    };
    if (entry.status === "unavailable") plugins.warn("plugin unavailable", { ...fields, reason: entry.reason });
    else plugins.debug("plugin loaded", fields);
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

/** An export outlives the window that started it; the engine leaves once none runs and no port came back. */
async function exitWhenSettled(): Promise<void> {
  await engine?.exportsSettled();
  if (lifetime.idle) await exitAfterClosing();
}

const lifetime = createLifetime(() => void exitWhenSettled());

async function serve(message: EngineBoot): Promise<EngineConnectionFactory> {
  const served = createEngine({ datasource: message.datasource, plugins: await plugins(message), log });
  engine = served;
  return (emit) => served.connect(emit);
}

async function probe(message: EngineBoot): Promise<never> {
  const result = await probeDatasource({ datasource: message.datasource, plugins: await plugins(message) });
  const probed: EngineProbed = { kind: ENGINE_PROBED_MESSAGE, result };
  parentPort.postMessage(probed);
  process.exit(0);
}

function attach(port: MessagePortMain, ready: Promise<EngineConnectionFactory>): void {
  const connection = ready.then((connect) => connect((event) => port.postMessage(event)));
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
