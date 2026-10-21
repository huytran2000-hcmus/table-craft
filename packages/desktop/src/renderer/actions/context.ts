import type { Capability } from "@table-craft/desktop/engine/protocol.js";
import {
  useConsoles,
  type ConsoleSession,
  type DatasourceState,
} from "@table-craft/desktop/renderer/state/consoles.js";
import { useLayout, type ToolWindowId } from "@table-craft/desktop/renderer/state/layout.js";
import { usePalette } from "@table-craft/desktop/renderer/state/palette.js";
import { activeTab, useTabs, type Tab } from "@table-craft/desktop/renderer/state/tabs.js";

/** The regions focus can be in; each is a `data-region` attribute on its container. */
export type FocusRegion = "editor" | "database" | "services" | "other";

export const REGION_ATTRIBUTE = "data-region";

/** A plain snapshot of the stores, taken at invoke time. Actions read this, never components. */
export interface ActionContext {
  readonly tabs: readonly Tab[];
  readonly activeTab: Tab | null;
  /** The active tab's console, when the active tab is one. */
  readonly console: ConsoleSession | null;
  readonly datasource: DatasourceState;
  readonly capabilities: readonly Capability[];
  readonly focus: FocusRegion;
  readonly toolWindows: Readonly<Record<ToolWindowId, boolean>>;
  readonly paletteOpen: boolean;
}

function focusedRegion(): FocusRegion {
  const region = document.activeElement?.closest(`[${REGION_ATTRIBUTE}]`)?.getAttribute(REGION_ATTRIBUTE);
  return region === "editor" || region === "database" || region === "services" ? region : "other";
}

export function currentContext(): ActionContext {
  const strip = useTabs.getState();
  const active = activeTab(strip);
  const { consoles, datasource } = useConsoles.getState();
  return {
    tabs: strip.tabs,
    activeTab: active,
    console: active?.kind === "console" ? (consoles[active.id] ?? null) : null,
    datasource,
    capabilities: datasource.capabilities,
    focus: focusedRegion(),
    toolWindows: useLayout.getState().layout.visible,
    paletteOpen: usePalette.getState().mode !== null,
  };
}
