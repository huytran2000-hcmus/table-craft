import { useEffect } from "react";
import { currentPlatform } from "@table-craft/desktop/renderer/actions/chords.js";
import { focusedRegion, modalOpen, trackFocus } from "@table-craft/desktop/renderer/actions/context.js";
import { openConsole } from "@table-craft/desktop/renderer/actions/datasourceCommands.js";
import { invoke, registry } from "@table-craft/desktop/renderer/actions/index.js";
import { installKeymap } from "@table-craft/desktop/renderer/actions/keymap.js";
import { bridge } from "@table-craft/desktop/renderer/bridge.js";
import { DataSourcesDialog } from "@table-craft/desktop/renderer/dialogs/DataSources.js";
import { Modal } from "@table-craft/desktop/renderer/dialogs/Modal.js";
import { SecretPrompt } from "@table-craft/desktop/renderer/dialogs/SecretPrompt.js";
import { Palette } from "@table-craft/desktop/renderer/palette/Palette.js";
import { Shell } from "@table-craft/desktop/renderer/shell/Shell.js";
import { useDatasources } from "@table-craft/desktop/renderer/state/datasources.js";
import { useTabs } from "@table-craft/desktop/renderer/state/tabs.js";
import { installDatasourceSync } from "@table-craft/desktop/renderer/state/wiring.js";
import { TooltipProvider } from "@table-craft/desktop/renderer/ui/Tooltip.js";

/** The `TABLE_CRAFT_DATASOURCE` seam opens straight into a console on it, as before (decision 018). */
function openEphemeralConsole(): void {
  const ephemeral = useDatasources.getState().datasources.find((datasource) => datasource.ephemeral);
  if (ephemeral !== undefined && useTabs.getState().tabs.length === 0) openConsole(ephemeral.id);
}

export function App() {
  useEffect(
    () =>
      installKeymap(window, {
        registry,
        platform: currentPlatform(),
        paletteOpen: modalOpen,
        focusedRegion,
      }),
    [],
  );

  useEffect(() => trackFocus(document), []);

  useEffect(() => bridge().onInvokeAction((actionId) => invoke(actionId)), []);

  useEffect(() => installDatasourceSync(openEphemeralConsole), []);

  return (
    <TooltipProvider>
      <Shell />
      <Palette />
      <DataSourcesDialog />
      <SecretPrompt />
      <Modal />
    </TooltipProvider>
  );
}
