import { create } from "zustand";
import type { EngineError, Namespace } from "@table-craft/desktop/engine/protocol.js";
import { EngineRequestError, type EngineClient } from "@table-craft/desktop/renderer/engine/client.js";
import { useConsoles } from "@table-craft/desktop/renderer/state/consoles.js";
import { useDatasources } from "@table-craft/desktop/renderer/state/datasources.js";

/** The console toolbar's namespace dropdown (decision 060): at most one open, on one console. */
export interface NamespaceSwitcherState {
  /** The console whose dropdown is open; null when none is. */
  readonly consoleId: string | null;
  readonly targets: readonly Namespace[];
  readonly loading: boolean;
  readonly error: EngineError | null;
  /** Opens the console's dropdown and lists its targets. */
  readonly show: (consoleId: string) => Promise<void>;
  readonly hide: () => void;
  /** Lists the open dropdown's targets again, from the database when `refresh`. */
  readonly load: (refresh: boolean) => Promise<void>;
}

export interface NamespaceSwitcherDependencies {
  /** The datasource's live client, connecting it when needed. */
  readonly connect: (datasourceId: string) => Promise<EngineClient>;
  readonly datasourceOf: (consoleId: string) => string | undefined;
}

const LIST_HINT = "Choose Refresh in the list to try again.";

function toEngineError(cause: unknown): EngineError {
  if (cause instanceof EngineRequestError) return { code: cause.code, message: cause.message, hint: cause.hint };
  return { code: "internal", message: cause instanceof Error ? cause.message : String(cause), hint: LIST_HINT };
}

export function createNamespaceSwitcherStore(dependencies: NamespaceSwitcherDependencies) {
  /** Bumped by every listing and by `hide`, so an answer for a closed or reopened list is dropped. */
  let listings = 0;
  return create<NamespaceSwitcherState>()((set, get) => {
    async function load(refresh: boolean): Promise<void> {
      const { consoleId } = get();
      const datasourceId = consoleId === null ? undefined : dependencies.datasourceOf(consoleId);
      if (datasourceId === undefined) return;
      const listing = ++listings;
      set({ loading: true, error: null });
      try {
        const client = await dependencies.connect(datasourceId);
        const targets = await client.call("namespace.targets", refresh ? { refresh } : {});
        if (listing === listings) set({ targets, loading: false });
      } catch (cause) {
        if (listing === listings) set({ error: toEngineError(cause), loading: false });
      }
    }

    return {
      consoleId: null,
      targets: [],
      loading: false,
      error: null,
      async show(consoleId) {
        set({ consoleId, targets: [], error: null });
        await load(false);
      },
      hide() {
        listings += 1;
        set({ consoleId: null, targets: [], loading: false, error: null });
      },
      load,
    };
  });
}

export const useNamespaceSwitcher = createNamespaceSwitcherStore({
  connect: (id) => useDatasources.getState().connect(id),
  datasourceOf: (consoleId) => useConsoles.getState().consoles[consoleId]?.datasourceId,
});
