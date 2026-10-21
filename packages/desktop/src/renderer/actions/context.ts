import type { Capability } from "@table-craft/desktop/engine/protocol.js";
import type { DatasourceView } from "@table-craft/desktop/preload/bridge.js";
import { useConsoles, type ConsoleSession } from "@table-craft/desktop/renderer/state/consoles.js";
import { useDataSourcesDialog } from "@table-craft/desktop/renderer/state/dataSourcesDialog.js";
import {
  capabilitiesOf,
  connectionOf,
  datasourceById,
  useDatasources,
  type Connection,
  type TreeSelection,
} from "@table-craft/desktop/renderer/state/datasources.js";
import { useLayout, type ToolWindowId } from "@table-craft/desktop/renderer/state/layout.js";
import { useModal } from "@table-craft/desktop/renderer/state/modal.js";
import { usePalette } from "@table-craft/desktop/renderer/state/palette.js";
import { useSecretPrompt } from "@table-craft/desktop/renderer/state/secretPrompt.js";
import { activeTab, useTabs, type Tab } from "@table-craft/desktop/renderer/state/tabs.js";

/** The regions focus can be in; each is a `data-region` attribute on its container. */
export type FocusRegion = "editor" | "database" | "services" | "other";

export const REGION_ATTRIBUTE = "data-region";

/** A datasource with what the window knows of it now. */
export interface DatasourceTarget {
  readonly view: DatasourceView;
  readonly connection: Connection;
  readonly capabilities: readonly Capability[];
}

/** A plain snapshot of the stores, taken at invoke time. Actions read this, never components. */
export interface ActionContext {
  readonly tabs: readonly Tab[];
  readonly activeTab: Tab | null;
  /** The active tab's console, when the active tab is one. */
  readonly console: ConsoleSession | null;
  readonly datasources: readonly DatasourceView[];
  readonly selection: TreeSelection | null;
  /**
   * What "the datasource" means to an action: the tree's selection while the Database pane has
   * focus, otherwise the active console's datasource, otherwise the tree's selection.
   */
  readonly datasource: DatasourceTarget | null;
  /** The active console's datasource's capabilities. */
  readonly capabilities: readonly Capability[];
  readonly focus: FocusRegion;
  readonly toolWindows: Readonly<Record<ToolWindowId, boolean>>;
  /** The palette or any dialog is open; it owns the keyboard. */
  readonly paletteOpen: boolean;
}

function regionOf(element: Element | null | undefined): FocusRegion {
  const region = element?.closest(`[${REGION_ATTRIBUTE}]`)?.getAttribute(REGION_ATTRIBUTE);
  return region === "editor" || region === "database" || region === "services" ? region : "other";
}

export function focusedRegion(): FocusRegion {
  return regionOf(document.activeElement);
}

/** The last region focus was in before a menu, dialog or the palette took it. */
let lastRegion: FocusRegion = "editor";

/** Remembers the last real region, so a context menu opened on the tree still means the tree. */
export function trackFocus(target: Pick<Document, "addEventListener" | "removeEventListener">): () => void {
  const listener = (event: FocusEvent) => {
    const region = regionOf(event.target instanceof Element ? event.target : null);
    if (region !== "other") lastRegion = region;
  };
  target.addEventListener("focusin", listener);
  return () => target.removeEventListener("focusin", listener);
}

/** Whether something modal holds the keyboard: the palette, a dialog or a prompt. */
export function modalOpen(): boolean {
  return (
    usePalette.getState().mode !== null ||
    useDataSourcesDialog.getState().target !== null ||
    useSecretPrompt.getState().pending !== null ||
    useModal.getState().pending !== null
  );
}

export function currentContext(): ActionContext {
  const strip = useTabs.getState();
  const active = activeTab(strip);
  const { consoles } = useConsoles.getState();
  const datasources = useDatasources.getState();
  const console = active?.kind === "console" ? (consoles[active.id] ?? null) : null;
  const focus = focusedRegion();
  const selected = datasources.selection?.kind === "datasource" ? datasources.selection.id : null;
  const inTree = focus === "database" || (focus === "other" && lastRegion === "database");
  const targetId = inTree ? selected : (console?.datasourceId ?? selected);
  const target = datasourceById(datasources, targetId);
  return {
    tabs: strip.tabs,
    activeTab: active,
    console,
    datasources: datasources.datasources,
    selection: datasources.selection,
    datasource:
      target === undefined
        ? null
        : {
            view: target,
            connection: connectionOf(datasources, target.id),
            capabilities: capabilitiesOf(datasources.plugins, target.pluginId),
          },
    capabilities:
      console === null
        ? []
        : capabilitiesOf(datasources.plugins, datasourceById(datasources, console.datasourceId)?.pluginId ?? ""),
    focus,
    toolWindows: useLayout.getState().layout.visible,
    paletteOpen: modalOpen(),
  };
}
