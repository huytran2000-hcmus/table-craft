import { BRIDGE_KEY, type TableCraftBridge } from "@table-craft/desktop/preload/bridge.js";

/** What preload exposed on `window`; the renderer's only way to reach main. */
export function bridge(): TableCraftBridge {
  return (window as unknown as Record<typeof BRIDGE_KEY, TableCraftBridge>)[BRIDGE_KEY];
}
