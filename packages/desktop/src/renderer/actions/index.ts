import { useSyncExternalStore } from "react";
import { APP_ACTIONS } from "@table-craft/desktop/renderer/actions/appActions.js";
import { currentContext } from "@table-craft/desktop/renderer/actions/context.js";
import { createActionRegistry, type InvokeOutcome } from "@table-craft/desktop/renderer/actions/registry.js";
import { useConsoles } from "@table-craft/desktop/renderer/state/consoles.js";
import { useLayout } from "@table-craft/desktop/renderer/state/layout.js";
import { usePalette } from "@table-craft/desktop/renderer/state/palette.js";
import { useTabs } from "@table-craft/desktop/renderer/state/tabs.js";

/** The app's one registry. Everything that runs a command goes through `invoke` (decision 015). */
export const registry = createActionRegistry(currentContext, (id, cause) => {
  console.error(`Action "${id}" failed.`, cause);
});
registry.register(APP_ACTIONS);

export function invoke(id: string, args?: unknown): InvokeOutcome {
  return registry.invoke(id, args);
}

const STORES = [useTabs, useConsoles, useLayout, usePalette] as const;

function subscribeToStores(listener: () => void): () => void {
  const unsubscribes = STORES.map((store) => store.subscribe(listener));
  return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
}

/** Whether `id` can run now, re-read whenever a store it might depend on changes. */
export function useActionEnabled(id: string): boolean {
  return useSyncExternalStore(subscribeToStores, () => registry.isEnabled(id));
}
