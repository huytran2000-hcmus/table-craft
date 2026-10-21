import { useEffect } from "react";
import { ACTION_IDS } from "@table-craft/desktop/renderer/actions/appActions.js";
import { currentPlatform } from "@table-craft/desktop/renderer/actions/chords.js";
import { invoke, registry } from "@table-craft/desktop/renderer/actions/index.js";
import { installKeymap } from "@table-craft/desktop/renderer/actions/keymap.js";
import { bridge } from "@table-craft/desktop/renderer/bridge.js";
import { Palette } from "@table-craft/desktop/renderer/palette/Palette.js";
import { Shell } from "@table-craft/desktop/renderer/shell/Shell.js";
import { usePalette } from "@table-craft/desktop/renderer/state/palette.js";
import { useTabs } from "@table-craft/desktop/renderer/state/tabs.js";
import { TooltipProvider } from "@table-craft/desktop/renderer/ui/Tooltip.js";

export function App() {
  useEffect(
    () =>
      installKeymap(window, {
        registry,
        platform: currentPlatform(),
        paletteOpen: () => usePalette.getState().mode !== null,
      }),
    [],
  );

  useEffect(() => bridge().onInvokeAction((actionId) => invoke(actionId)), []);

  useEffect(() => {
    if (useTabs.getState().tabs.length === 0) invoke(ACTION_IDS.newConsole);
  }, []);

  return (
    <TooltipProvider>
      <Shell />
      <Palette />
    </TooltipProvider>
  );
}
