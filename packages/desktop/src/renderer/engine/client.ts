import type {
  EngineCalls,
  EngineError,
  EngineErrorCode,
  EngineMethod,
  EngineResponse,
  ResultOf,
} from "@table-craft/desktop/engine/protocol.js";
import { ENGINE_PORT_WINDOW_MESSAGE } from "@table-craft/desktop/preload/bridge.js";
import { bridge } from "@table-craft/desktop/renderer/bridge.js";

/** A request the engine answered with `engine.error`. */
export class EngineRequestError extends Error {
  override readonly name = "EngineRequestError";
  readonly code: EngineErrorCode;
  readonly hint: string;

  constructor(error: EngineError) {
    super(error.message);
    this.code = error.code;
    this.hint = error.hint;
  }
}

export interface EngineClient {
  call<M extends EngineMethod>(type: M, params: EngineCalls[M]["params"]): Promise<ResultOf<M>>;
}

interface Pending {
  resolve(result: unknown): void;
  reject(error: Error): void;
}

function clientFor(port: MessagePort): EngineClient {
  const pending = new Map<number, Pending>();
  let nextId = 1;

  port.addEventListener("message", (event: MessageEvent<EngineResponse>) => {
    const response = event.data;
    if (response.id === null) {
      console.error(
        `engine rejected an unreadable request: ${response.type === "engine.error" ? response.error.message : ""}`,
      );
      return;
    }
    const waiting = pending.get(response.id);
    if (waiting === undefined) return;
    pending.delete(response.id);
    if (response.type === "engine.error") waiting.reject(new EngineRequestError(response.error));
    else waiting.resolve(response.result);
  });
  port.start();

  return {
    call(type, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        port.postMessage({ ...params, id, type });
      });
    },
  };
}

/** Asks main for an engine port and resolves once preload has relayed it. */
export function connectEngine(): Promise<EngineClient> {
  return new Promise((resolve) => {
    function receive(event: MessageEvent<{ kind?: unknown } | null>): void {
      if (event.source !== window || event.data?.kind !== ENGINE_PORT_WINDOW_MESSAGE) return;
      const port = event.ports[0];
      if (port === undefined) return;
      window.removeEventListener("message", receive);
      resolve(clientFor(port));
    }
    window.addEventListener("message", receive);
    bridge().connectEngine();
  });
}
