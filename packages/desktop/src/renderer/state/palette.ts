import { create } from "zustand";
import { ALL_TAB, pushRecent, type PaletteMode } from "@table-craft/desktop/renderer/model/palette.js";

export interface PaletteState {
  /** `null` while the palette is closed. */
  readonly mode: PaletteMode | null;
  readonly tab: string;
  /** Action ids run from the palette, most recent first. */
  readonly recent: readonly string[];
  readonly show: (mode: PaletteMode) => void;
  readonly hide: () => void;
  readonly selectTab: (tab: string) => void;
  readonly remember: (id: string) => void;
}

export const usePalette = create<PaletteState>()((set, get) => ({
  mode: null,
  tab: ALL_TAB,
  recent: [],
  show: (mode) => set({ mode, tab: ALL_TAB }),
  hide: () => set({ mode: null }),
  selectTab: (tab) => set({ tab }),
  remember: (id) => set({ recent: pushRecent(get().recent, id) }),
}));
