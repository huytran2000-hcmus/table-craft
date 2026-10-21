/**
 * What preload and renderer agree on. Declarations only, so the sandboxed renderer can import it
 * without pulling in `electron`.
 */

export const CHANNELS = {
  /** Renderer to main: this window is ready for an engine port. */
  connectEngine: "table-craft:connect-engine",
  /** Main to preload: here is a fresh engine port. */
  enginePort: "table-craft:engine-port",
} as const;

/** The `window.postMessage` kind preload uses to hand the port on; contextBridge cannot carry one. */
export const ENGINE_PORT_WINDOW_MESSAGE = "table-craft:engine-port";

export const BRIDGE_KEY = "tableCraft";

export interface TableCraftBridge {
  /** Asks main for an engine port; it arrives as a window message of kind `ENGINE_PORT_WINDOW_MESSAGE`. */
  connectEngine(): void;
}
