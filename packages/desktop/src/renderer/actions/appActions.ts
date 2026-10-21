import type { ActionContext } from "@table-craft/desktop/renderer/actions/context.js";
import {
  askMoveToFolder,
  askNewFolder,
  deleteDatasource,
  openConsole,
} from "@table-craft/desktop/renderer/actions/datasourceCommands.js";
import { defineAction, type AnyAction } from "@table-craft/desktop/renderer/actions/registry.js";
import { focusRegion } from "@table-craft/desktop/renderer/shell/focus.js";
import { canRun, useConsoles } from "@table-craft/desktop/renderer/state/consoles.js";
import { useDataSourcesDialog } from "@table-craft/desktop/renderer/state/dataSourcesDialog.js";
import { useDatasources } from "@table-craft/desktop/renderer/state/datasources.js";
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
  newDatasource: "datasource.new",
  datasourceProperties: "datasource.properties",
  duplicateDatasource: "datasource.duplicate",
  deleteDatasource: "datasource.delete",
  connect: "datasource.connect",
  disconnect: "datasource.disconnect",
  newFolder: "datasource.newFolder",
  moveToFolder: "datasource.moveToFolder",
  synchronize: "database.synchronize",
  collapseAll: "explorer.collapseAll",
  toggleSystemSchemas: "explorer.toggleSystemSchemas",
  copyName: "explorer.copyName",
  reveal: "explorer.reveal",
} as const;

/** Names a tab when an action runs on one other than the active tab, as the tab menu does. */
export interface TabArgs {
  readonly tabId?: string;
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
const hasDatasource = (context: ActionContext) => context.datasource !== null;
const isSaved = (context: ActionContext) => context.datasource !== null && !context.datasource.view.ephemeral;
const isLive = (context: ActionContext) =>
  context.datasource?.connection.status === "connected" || context.datasource?.connection.status === "connecting";

/** The folder New Folder and New Data Source put things in: the selected one, or the selected datasource's. */
function selectedFolder(context: ActionContext): string | null {
  if (context.selection?.kind === "folder") return context.selection.path;
  return context.focus === "database" ? (context.datasource?.view.folder ?? null) : null;
}
const hasSeveralTabs = (context: ActionContext) => context.tabs.length > 1;

export const APP_ACTIONS: readonly AnyAction[] = [
  defineAction({
    id: ACTION_IDS.run,
    title: "Run",
    category: "Console",
    icon: "run",
    shortcut: "Mod+Enter",
    when: (context) => context.console !== null && canRun(context.console.status),
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
    when: hasDatasource,
    run: (context) => {
      if (context.datasource !== null) openConsole(context.datasource.view.id);
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
    when: (context) => (context.focus === "database" || context.focus === "services") && !context.speedSearching,
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
  defineAction({
    id: ACTION_IDS.newDatasource,
    title: "New Data Source…",
    category: "Database",
    icon: "add",
    shortcut: "Mod+N",
    shortcutRegion: "database",
    run: (context) =>
      useDataSourcesDialog.getState().show({ kind: "new", pluginId: null, folder: selectedFolder(context) ?? "" }),
  }),
  defineAction({
    id: ACTION_IDS.datasourceProperties,
    title: "Data Source Properties…",
    category: "Database",
    icon: "properties",
    shortcut: "Mod+;",
    run: (context) => useDataSourcesDialog.getState().show({ kind: "edit", id: context.datasource?.view.id ?? null }),
  }),
  defineAction({
    id: ACTION_IDS.duplicateDatasource,
    title: "Duplicate Data Source",
    category: "Database",
    icon: "duplicate",
    shortcut: "Mod+D",
    shortcutRegion: "database",
    when: hasDatasource,
    run: (context) => {
      if (context.datasource !== null) {
        useDataSourcesDialog.getState().show({ kind: "duplicate", id: context.datasource.view.id });
      }
    },
  }),
  defineAction({
    id: ACTION_IDS.deleteDatasource,
    title: "Delete Data Source",
    category: "Database",
    icon: "delete",
    shortcut: "Delete",
    shortcutRegion: "database",
    when: isSaved,
    run: async (context) => {
      if (context.datasource !== null) await deleteDatasource(context.datasource.view);
    },
  }),
  defineAction({
    id: ACTION_IDS.connect,
    title: "Connect",
    category: "Database",
    icon: "connect",
    when: (context) => hasDatasource(context) && !isLive(context),
    run: (context) => {
      if (context.datasource !== null) {
        // The tree and status bar show a failure; nothing else waits on it.
        useDatasources
          .getState()
          .connect(context.datasource.view.id)
          .catch(() => undefined);
      }
    },
  }),
  defineAction({
    id: ACTION_IDS.disconnect,
    title: "Disconnect",
    category: "Database",
    icon: "disconnect",
    shortcut: "Mod+F2",
    when: isLive,
    run: async (context) => {
      if (context.datasource !== null) await useDatasources.getState().disconnect(context.datasource.view.id);
    },
  }),
  defineAction({
    id: ACTION_IDS.newFolder,
    title: "New Folder…",
    category: "Database",
    icon: "folder",
    run: (context) => askNewFolder(selectedFolder(context)),
  }),
  defineAction({
    id: ACTION_IDS.moveToFolder,
    title: "Move to Folder…",
    category: "Database",
    when: isSaved,
    run: async (context) => {
      if (context.datasource !== null) await askMoveToFolder(context.datasource.view);
    },
  }),
];
