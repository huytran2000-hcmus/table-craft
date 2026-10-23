import { describe, expect, it } from "vitest";
import { EXPORT_EVENT_TYPES, IMPORT_EVENT_TYPES, type EngineEvent } from "@table-craft/desktop/engine/protocol.js";
import { clientFor } from "@table-craft/desktop/renderer/engine/client.js";

const DELIVERY_WAIT_MS = 1_000;

describe("engine client", () => {
  it("givenEveryTaskEventType_whenPosted_thenListenersReceiveIt", async () => {
    const channel = new MessageChannel();
    const client = clientFor(channel.port1);
    const types = [...EXPORT_EVENT_TYPES, ...IMPORT_EVENT_TYPES];
    const received: string[] = [];
    const all = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`received only ${received.join(", ")}`));
      }, DELIVERY_WAIT_MS);
      client.onEvent((event: EngineEvent) => {
        received.push(event.type);
        if (received.length === types.length) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    for (const type of types) channel.port2.postMessage({ id: null, type, task: {} });
    await all;
    expect(received).toEqual(types);
    channel.port1.close();
  });
});
