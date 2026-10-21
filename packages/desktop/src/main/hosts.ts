/**
 * One engine `utilityProcess` per datasource (decision 002). Main is not in the request path: it
 * boots the engine, hands one end of a `MessageChannelMain` to it and the other to the renderer,
 * and stays out of the way, so no request shape from `protocol.ts` is inspected here.
 */
import { MessageChannelMain, utilityProcess, type UtilityProcess, type WebContents } from "electron";
import {
  ENGINE_BOOT_MESSAGE,
  ENGINE_PORT_MESSAGE,
  type DatasourceConfig,
  type EngineBoot,
} from "@table-craft/desktop/engine/protocol.js";
import { CHANNELS } from "@table-craft/desktop/preload/bridge.js";

const SERVICE_NAME_PREFIX = "table-craft-engine-";
/** stdout and stderr inherit the app's, so engine output reaches the terminal that launched it. */
const HOST_STDIO = "inherit";

export interface HostRegistryOptions {
  /** The built `engine/main.js`. Passed in so `main.ts` owns every path decision. */
  readonly entryFile: string;
  readonly pluginRoots: readonly string[];
}

export interface HostRegistry {
  /** Starts the host for `datasource` if needed and gives `contents` a fresh port to it. */
  open(datasource: DatasourceConfig, contents: WebContents): void;
  closeAll(): void;
}

export function createHostRegistry(options: HostRegistryOptions): HostRegistry {
  const hosts = new Map<string, UtilityProcess>();

  function spawn(datasource: DatasourceConfig): UtilityProcess {
    const host = utilityProcess.fork(options.entryFile, [], {
      serviceName: `${SERVICE_NAME_PREFIX}${datasource.id}`,
      stdio: HOST_STDIO,
    });
    const boot: EngineBoot = { kind: ENGINE_BOOT_MESSAGE, datasource, pluginRoots: options.pluginRoots };
    host.postMessage(boot);
    host.once("exit", () => hosts.delete(datasource.id));
    hosts.set(datasource.id, host);
    return host;
  }

  return {
    open(datasource, contents) {
      const host = hosts.get(datasource.id) ?? spawn(datasource);
      const channel = new MessageChannelMain();
      host.postMessage({ kind: ENGINE_PORT_MESSAGE }, [channel.port1]);
      contents.postMessage(CHANNELS.enginePort, null, [channel.port2]);
    },
    closeAll() {
      for (const host of hosts.values()) host.kill();
      hosts.clear();
    },
  };
}
