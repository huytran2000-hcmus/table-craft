import { create } from "zustand";
import type { UpdateState } from "@table-craft/desktop/preload/bridge.js";
import { bridge } from "@table-craft/desktop/renderer/bridge.js";

export interface UpdateStore {
  /** Main's updater state, as pushed on `CHANNELS.updateState` (plan 020 decision 8). */
  readonly state: UpdateState;
  /** Whether the Update button's popover is open. */
  readonly open: boolean;
  readonly changed: (state: UpdateState) => void;
  readonly setOpen: (open: boolean) => void;
}

const UNKNOWN_VERSION = "";

export const useUpdate = create<UpdateStore>()((set) => ({
  state: { phase: "idle", current: UNKNOWN_VERSION },
  open: false,
  changed: (state) =>
    set((previous) => ({
      state,
      // Nothing left to show, so nothing stays open over the toolbar.
      open: previous.open && state.phase !== "idle" && state.phase !== "checking",
    })),
  setOpen: (open) => set({ open }),
}));

/** Asks main for the updater's state once and follows it; returns the unsubscribe. */
export function installUpdateState(): () => void {
  let live = true;
  void bridge()
    .updateState()
    .then((answer) => {
      if (live && answer.ok) useUpdate.getState().changed(answer.value);
    });
  const unsubscribe = bridge().onUpdateState((state) => useUpdate.getState().changed(state));
  return () => {
    live = false;
    unsubscribe();
  };
}
