import { create } from "zustand";

/** What the Data Sources dialog opens on. */
export type DialogTarget =
  | { readonly kind: "edit"; readonly id: string | null }
  | { readonly kind: "new"; readonly pluginId: string | null; readonly folder: string }
  | { readonly kind: "duplicate"; readonly id: string };

export interface DataSourcesDialogState {
  /** Null while closed; a new object each time it opens, so the dialog starts fresh. */
  readonly target: DialogTarget | null;
  readonly show: (target: DialogTarget) => void;
  readonly hide: () => void;
}

export const useDataSourcesDialog = create<DataSourcesDialogState>()((set) => ({
  target: null,
  show: (target) => set({ target }),
  hide: () => set({ target: null }),
}));
