import { create } from "zustand";
import type { QuickDocTarget } from "@table-craft/desktop/renderer/model/quickDoc.js";
import type { PopoverAnchor } from "@table-craft/desktop/renderer/ui/Popover.js";

export interface QuickDocState {
  /** The popover showing, if any (plan 010 decision 11). */
  readonly shown: { readonly target: QuickDocTarget; readonly anchor: PopoverAnchor } | null;
  readonly show: (target: QuickDocTarget, anchor: PopoverAnchor) => void;
  readonly close: () => void;
}

export const useQuickDoc = create<QuickDocState>()((set) => ({
  shown: null,
  show: (target, anchor) => set({ shown: { target, anchor } }),
  close: () => set({ shown: null }),
}));
