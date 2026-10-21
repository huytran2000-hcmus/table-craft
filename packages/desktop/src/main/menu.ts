import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from "electron";
import { CHANNELS } from "@table-craft/desktop/preload/bridge.js";
import { APPLICATION_MENU, type MenuEntry } from "@table-craft/desktop/preload/menu.js";

const MAC_PLATFORM = "darwin";

function toTemplate(entry: MenuEntry, target: () => BrowserWindow | null): MenuItemConstructorOptions {
  switch (entry.kind) {
    case "separator":
      return { type: "separator" };
    case "role":
      return { role: entry.role };
    case "submenu":
      return { label: entry.label, submenu: entry.items.map((item) => toTemplate(item, target)) };
    case "action":
      return {
        label: entry.label,
        ...(entry.accelerator === undefined ? {} : { accelerator: entry.accelerator }),
        // The renderer keymap dispatches every chord; the menu only shows it. macOS ignores this
        // flag, and there an unhandled key equivalent reaches the menu, whose click runs the same
        // action through the same `invoke` (decision 9).
        registerAccelerator: false,
        click: () => target()?.webContents.send(CHANNELS.invokeAction, entry.actionId),
      };
  }
}

/** Builds and installs the application menu; `target` is the window a click acts on. */
export function installApplicationMenu(target: () => BrowserWindow | null): void {
  const mac = process.platform === MAC_PLATFORM;
  const template = APPLICATION_MENU.filter((entry) => mac || entry.kind !== "role" || entry.macOnly !== true).map(
    (entry) => toTemplate(entry, target),
  );
  if (mac) template.unshift({ role: "appMenu" });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
