import { describe, expect, it } from "vitest";
import { menuActionIds, menuActionItems, menuFor, type MenuEntry } from "@table-craft/desktop/preload/menu.js";
import { ALL_ACTIONS } from "@table-craft/desktop/renderer/actions/allActions.js";

const ELECTRON_MOD = "CmdOrCtrl";

function electronAccelerator(chord: string): string {
  return chord.replace(/^Mod\+/, `${ELECTRON_MOD}+`);
}

function labelsOf(entries: readonly MenuEntry[]): string[] {
  return entries.map((entry) => {
    if (entry.kind === "separator") return "-";
    if (entry.kind === "role") return `(${entry.role})`;
    return entry.label;
  });
}

describe("application menu", () => {
  it("givenMac_whenBuilt_thenAppMenuLeadsWithSettingsWhereMacUsersLook", () => {
    const [appMenu, file] = menuFor(true);

    expect(appMenu?.kind === "submenu" ? labelsOf(appMenu.items) : []).toEqual([
      "(about)",
      "-",
      "Settings…",
      "-",
      "(services)",
      "-",
      "(hide)",
      "(hideOthers)",
      "(unhide)",
      "-",
      "(quit)",
    ]);
    expect(file?.kind === "submenu" ? labelsOf(file.items) : []).not.toContain("Settings…");
  });

  it("givenWindowsOrLinux_whenBuilt_thenFileHoldsSettingsAboveItsLastSeparator", () => {
    const [file] = menuFor(false);
    const items = file?.kind === "submenu" ? labelsOf(file.items) : [];

    expect(file?.kind === "submenu" ? file.label : "").toBe("File");
    expect(items.slice(-3)).toEqual(["Settings…", "-", "Close Tab"]);
    expect(menuActionIds(menuFor(false)).filter((id) => id === "settings.show")).toHaveLength(1);
  });

  it("givenMenuDeclaration_whenComparedWithRegistry_thenEveryActionIdExists", () => {
    const registered = new Set(ALL_ACTIONS.map((action) => action.id));

    expect(menuActionIds().filter((id) => !registered.has(id))).toEqual([]);
  });

  it("givenMenuAccelerator_whenComparedWithAction_thenItShowsTheActionChord", () => {
    const shortcuts = new Map(ALL_ACTIONS.map((action) => [action.id, action.shortcut]));

    for (const item of menuActionItems()) {
      if (item.accelerator === undefined) continue;
      const shortcut = shortcuts.get(item.actionId);
      expect(shortcut, item.actionId).toBeDefined();
      expect(item.accelerator, item.actionId).toBe(electronAccelerator(shortcut ?? ""));
    }
  });
});
