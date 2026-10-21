import type { ActionContext } from "@table-craft/desktop/renderer/actions/context.js";
import { defineAction, type AnyAction } from "@table-craft/desktop/renderer/actions/registry.js";
import { focusRegion } from "@table-craft/desktop/renderer/shell/focus.js";
import { useConsoles } from "@table-craft/desktop/renderer/state/consoles.js";
import { useLayout, type ToolWindowId } from "@table-craft/desktop/renderer/state/layout.js";
import { usePalette } from "@table-craft/desktop/renderer/state/palette.js";
import { useTabs, type Tab } from "@table-craft/desktop/renderer/state/tabs.js";

/** Action ids other modules name: the menu declaration, toolbar buttons, the palette. */
export const ACTION_IDS = {
  run: "console.run",
  cancel: "console.cancel",
  newConsole: "console.new",
  closeTab: "tab.close",
  closeOtherTabs: "tab.closeOthers",
  closeAllTabs: "tab.closeAll",
  nextTab: "tab.next",
  previousTab: "tab.previous",
  toggleDatabase: "toolWindow.database.toggle",
  toggleServices: "toolWindow.services.toggle",
  hideAllToolWindows: "toolWindow.hideAll",
  focusEditor: "focus.editor",
  findAction: "palette.findAction",
  searchEverywhere: "palette.searchEverywhere",
} as const;

/** Names a tab when an action runs on one other than the active tab, as the tab menu does. */
export interface TabArgs {
  readonly tabId?: string;
}

const CONSOLE_TITLE = "console";
const CONSOLE_ID_PREFIX = "console-";
let consolesOpened = 0;

/** DataGrip's naming: `console`, then `console_1`, `console_2`. */
function nextConsole(): Tab {
  const index = consolesOpened++;
  return {
    id: `${CONSOLE_ID_PREFIX}${index}`,
    kind: "console",
    title: index === 0 ? CONSOLE_TITLE : `${CONSOLE_TITLE}_${index}`,
  };
}

function release(tabs: readonly Tab[]): void {
  for (const tab of tabs) if (tab.kind === "console") useConsoles.getState().close(tab.id);
}

function targetTab(context: ActionContext, args: TabArgs | undefined): string | null {
  return args?.tabId ?? context.activeTab?.id ?? null;
}

function toggleToolWindow(id: ToolWindowId, context: ActionContext): void {
  const wasFocused = context.focus === id;
  useLayout.getState().toggle(id);
  if (wasFocused) focusRegion("editor");
}

const hasTabs = (context: ActionContext) => context.tabs.length > 0;
const hasSeveralTabs = (context: ActionContext) => context.tabs.length > 1;

export const APP_ACTIONS: readonly AnyAction[] = [
  defineAction({
    id: ACTION_IDS.run,
    title: "Run",
    category: "Console",
    icon: "run",
    shortcut: "Mod+Enter",
    when: (context) => context.console?.status === "ready",
    run: (context) => {
      if (context.activeTab !== null) void useConsoles.getState().run(context.activeTab.id);
    },
  }),
  defineAction({
    id: ACTION_IDS.cancel,
    title: "Cancel",
    category: "Console",
    icon: "cancel",
    when: (context) => context.console?.status === "running" && context.capabilities.includes("cancel"),
    run: (context) => {
      if (context.activeTab !== null) void useConsoles.getState().cancel(context.activeTab.id);
    },
  }),
  defineAction({
    id: ACTION_IDS.newConsole,
    title: "New Console",
    category: "Console",
    icon: "newConsole",
    shortcut: "Mod+Shift+L",
    run: () => {
      const tab = nextConsole();
      useTabs.getState().open(tab);
      void useConsoles.getState().open(tab.id);
    },
  }),
  defineAction<TabArgs | undefined>({
    id: ACTION_IDS.closeTab,
    title: "Close Tab",
    category: "Editor Tabs",
    icon: "close",
    shortcut: "Mod+W",
    when: hasTabs,
    run: (context, args) => {
      const id = targetTab(context, args);
      if (id !== null) release(useTabs.getState().close(id));
    },
  }),
  defineAction<TabArgs | undefined>({
    id: ACTION_IDS.closeOtherTabs,
    title: "Close Other Tabs",
    category: "Editor Tabs",
    when: hasSeveralTabs,
    run: (context, args) => {
      const id = targetTab(context, args);
      if (id !== null) release(useTabs.getState().closeOthers(id));
    },
  }),
  defineAction({
    id: ACTION_IDS.closeAllTabs,
    title: "Close All Tabs",
    category: "Editor Tabs",
    when: hasTabs,
    run: () => release(useTabs.getState().closeAll()),
  }),
  defineAction({
    id: ACTION_IDS.nextTab,
    title: "Select Next Tab",
    category: "Editor Tabs",
    shortcut: "Mod+Shift+]",
    when: hasSeveralTabs,
    run: () => useTabs.getState().cycle(1),
  }),
  defineAction({
    id: ACTION_IDS.previousTab,
    title: "Select Previous Tab",
    category: "Editor Tabs",
    shortcut: "Mod+Shift+[",
    when: hasSeveralTabs,
    run: () => useTabs.getState().cycle(-1),
  }),
  defineAction({
    id: ACTION_IDS.toggleDatabase,
    title: "Database",
    category: "Tool Windows",
    icon: "database",
    shortcut: "Mod+1",
    run: (context) => toggleToolWindow("database", context),
  }),
  defineAction({
    id: ACTION_IDS.toggleServices,
    title: "Services",
    category: "Tool Windows",
    icon: "services",
    shortcut: "Mod+8",
    run: (context) => toggleToolWindow("services", context),
  }),
  defineAction({
    id: ACTION_IDS.hideAllToolWindows,
    title: "Hide All Tool Windows",
    category: "Tool Windows",
    shortcut: "Mod+Shift+F12",
    run: (context) => {
      const wasInToolWindow = context.focus === "database" || context.focus === "services";
      useLayout.getState().hideAll();
      if (wasInToolWindow) focusRegion("editor");
    },
  }),
  defineAction({
    id: ACTION_IDS.focusEditor,
    title: "Back to Editor",
    category: "Navigation",
    shortcut: "Escape",
    when: (context) => context.focus === "database" || context.focus === "services",
    run: () => focusRegion("editor"),
  }),
  defineAction({
    id: ACTION_IDS.findAction,
    title: "Find Action…",
    category: "Navigation",
    icon: "search",
    shortcut: "Mod+Shift+A",
    run: () => usePalette.getState().show("findAction"),
  }),
  defineAction({
    id: ACTION_IDS.searchEverywhere,
    title: "Search Everywhere",
    category: "Navigation",
    icon: "search",
    shortcut: "Shift Shift",
    run: () => usePalette.getState().show("searchEverywhere"),
  }),
];
