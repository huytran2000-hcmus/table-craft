import { describe, expect, it } from "vitest";
import { menuActionIds, menuActionItems } from "@table-craft/desktop/preload/menu.js";
import { ALL_ACTIONS } from "@table-craft/desktop/renderer/actions/allActions.js";

const ELECTRON_MOD = "CmdOrCtrl";

function electronAccelerator(chord: string): string {
  return chord.replace(/^Mod\+/, `${ELECTRON_MOD}+`);
}

describe("application menu", () => {
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
