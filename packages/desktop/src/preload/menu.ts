/**
 * The application menu as data (plan 003, decision 8). Declarations only: main builds it, and a
 * click sends the item's action id to the renderer, which runs it through the action registry.
 * Main never decides whether an action is enabled.
 */

/** An item that runs a renderer action. `accelerator` is Electron's spelling of the action's chord. */
export interface ActionMenuItem {
  readonly kind: "action";
  readonly label: string;
  readonly actionId: string;
  readonly accelerator?: string;
}

/** Electron's built-in menu or item roles that this menu uses. */
export type MenuRole = "editMenu" | "windowMenu" | "toggleDevTools";

export interface RoleMenuItem {
  readonly kind: "role";
  readonly role: MenuRole;
  readonly macOnly?: boolean;
}

export interface SubmenuItem {
  readonly kind: "submenu";
  readonly label: string;
  readonly items: readonly MenuEntry[];
}

export interface SeparatorItem {
  readonly kind: "separator";
}

export type MenuEntry = ActionMenuItem | RoleMenuItem | SubmenuItem | SeparatorItem;

const SEPARATOR: SeparatorItem = { kind: "separator" };

/** The menu bar after the macOS app menu, which main adds from the `appMenu` role on darwin only. */
export const APPLICATION_MENU: readonly MenuEntry[] = [
  {
    kind: "submenu",
    label: "File",
    items: [
      // No accelerator: ⌘N belongs to the Database tool window alone (plan 004).
      { kind: "action", label: "New Data Source…", actionId: "datasource.new" },
      { kind: "action", label: "New Console", actionId: "console.new", accelerator: "CmdOrCtrl+Shift+L" },
      SEPARATOR,
      {
        kind: "action",
        label: "Data Source Properties…",
        actionId: "datasource.properties",
        accelerator: "CmdOrCtrl+;",
      },
      { kind: "action", label: "Disconnect", actionId: "datasource.disconnect", accelerator: "CmdOrCtrl+F2" },
      { kind: "action", label: "Synchronize", actionId: "database.synchronize", accelerator: "CmdOrCtrl+Alt+Y" },
      SEPARATOR,
      { kind: "action", label: "Close Tab", actionId: "tab.close", accelerator: "CmdOrCtrl+W" },
    ],
  },
  { kind: "role", role: "editMenu" },
  {
    kind: "submenu",
    label: "View",
    items: [
      {
        kind: "submenu",
        label: "Tool Windows",
        items: [
          { kind: "action", label: "Database", actionId: "toolWindow.database.toggle", accelerator: "CmdOrCtrl+1" },
          { kind: "action", label: "Services", actionId: "toolWindow.services.toggle", accelerator: "CmdOrCtrl+8" },
        ],
      },
      {
        kind: "action",
        label: "Hide All Tool Windows",
        actionId: "toolWindow.hideAll",
        accelerator: "CmdOrCtrl+Shift+F12",
      },
      { kind: "action", label: "Show System Schemas", actionId: "explorer.toggleSystemSchemas" },
      SEPARATOR,
      { kind: "action", label: "Find Action…", actionId: "palette.findAction", accelerator: "CmdOrCtrl+Shift+A" },
      // No accelerator: Electron cannot express a double Shift.
      { kind: "action", label: "Search Everywhere", actionId: "palette.searchEverywhere" },
      SEPARATOR,
      { kind: "role", role: "toggleDevTools" },
    ],
  },
  // Elsewhere the role adds Close with a registered Ctrl+W, which would close the window instead of the tab.
  { kind: "role", role: "windowMenu", macOnly: true },
  {
    kind: "submenu",
    label: "Help",
    items: [{ kind: "action", label: "Find Action…", actionId: "palette.findAction" }],
  },
];

/** Every action id the menu names, for the test that checks each one is registered. */
export function menuActionIds(entries: readonly MenuEntry[] = APPLICATION_MENU): readonly string[] {
  return entries.flatMap((entry) => {
    if (entry.kind === "action") return [entry.actionId];
    if (entry.kind === "submenu") return menuActionIds(entry.items);
    return [];
  });
}

export function menuActionItems(entries: readonly MenuEntry[] = APPLICATION_MENU): readonly ActionMenuItem[] {
  return entries.flatMap((entry) => {
    if (entry.kind === "action") return [entry];
    if (entry.kind === "submenu") return menuActionItems(entry.items);
    return [];
  });
}
