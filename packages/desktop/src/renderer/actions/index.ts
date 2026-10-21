import { useSyncExternalStore } from "react";
import { ALL_ACTIONS } from "@table-craft/desktop/renderer/actions/allActions.js";
import { currentContext } from "@table-craft/desktop/renderer/actions/context.js";
import { createActionRegistry, type InvokeOutcome } from "@table-craft/desktop/renderer/actions/registry.js";
import { useCatalog } from "@table-craft/desktop/renderer/state/catalog.js";
import { useConsoles } from "@table-craft/desktop/renderer/state/consoles.js";
import { useDataSourcesDialog } from "@table-craft/desktop/renderer/state/dataSourcesDialog.js";
import { useDatasources } from "@table-craft/desktop/renderer/state/datasources.js";
import { useLayout } from "@table-craft/desktop/renderer/state/layout.js";
import { useModal } from "@table-craft/desktop/renderer/state/modal.js";
import { usePalette } from "@table-craft/desktop/renderer/state/palette.js";
import { useSecretPrompt } from "@table-craft/desktop/renderer/state/secretPrompt.js";
import { useTabs } from "@table-craft/desktop/renderer/state/tabs.js";

/** The app's one registry. Everything that runs a command goes through `invoke` (decision 015). */
export const registry = createActionRegistry(currentContext, (id, cause) => {
  console.error(`Action "${id}" failed.`, cause);
});
registry.register(ALL_ACTIONS);

export function invoke(id: string, args?: unknown): InvokeOutcome {
  return registry.invoke(id, args);
}

const STORES = [
  useTabs,
  useConsoles,
  useDatasources,
  useCatalog,
  useLayout,
  usePalette,
  useDataSourcesDialog,
  useSecretPrompt,
  useModal,
] as const;

function subscribeToStores(listener: () => void): () => void {
  const unsubscribes = STORES.map((store) => store.subscribe(listener));
  return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
}

/** Whether `id` can run now, re-read whenever a store it might depend on changes. */
export function useActionEnabled(id: string): boolean {
  return useSyncExternalStore(subscribeToStores, () => registry.isEnabled(id));
}
