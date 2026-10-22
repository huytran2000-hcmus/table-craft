import { create } from "zustand";
import type { WindowState } from "@table-craft/desktop/preload/bridge.js";
import { bridge } from "@table-craft/desktop/renderer/bridge.js";

export interface WindowStateStore extends WindowState {
  readonly changed: (state: WindowState) => void;
}

/**
 * The window's frame and full-screen state, as main reports them (decision 034). Until main answers,
 * the frame is assumed custom, which is the default, so the first frame already leaves room for the
 * traffic lights.
 */
export const useWindowState = create<WindowStateStore>()((set) => ({
  fullScreen: false,
  customTitleBar: true,
  changed: (state) => set({ fullScreen: state.fullScreen, customTitleBar: state.customTitleBar }),
}));

/** Asks main for the window's state once and follows its full-screen changes; returns the unsubscribe. */
export function installWindowState(): () => void {
  const { changed } = useWindowState.getState();
  let live = true;
  void bridge()
    .windowState()
    .then((answer) => {
      if (live && answer.ok) changed(answer.value);
    });
  const unsubscribe = bridge().onWindowState(changed);
  return () => {
    live = false;
    unsubscribe();
  };
}
