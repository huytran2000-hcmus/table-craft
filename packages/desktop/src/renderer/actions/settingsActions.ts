import { defineAction, type AnyAction } from "@table-craft/desktop/renderer/actions/registry.js";
import { useSettings } from "@table-craft/desktop/renderer/state/settings.js";
import { useSettingsDialog } from "@table-craft/desktop/renderer/state/settingsDialog.js";
import { DEFAULT_SETTINGS, zoomEditorFont } from "@table-craft/desktop/settings/settings.js";

export const SETTINGS_ACTION_IDS = {
  show: "settings.show",
  zoomIn: "editor.zoomIn",
  zoomOut: "editor.zoomOut",
  zoomReset: "editor.zoomReset",
} as const;

const ZOOM_STEP_PX = 1;

function zoom(steps: number): Promise<void> {
  return useSettings.getState().update((settings) => {
    const next = zoomEditorFont(settings, steps);
    return next.appearance.fonts.editor.sizePx === settings.appearance.fonts.editor.sizePx ? settings : next;
  });
}

/**
 * Settings and the editor zoom (plan 013). Zoom changes the saved editor font size, so every
 * console follows and the size survives a relaunch; there is no per-tab zoom.
 */
export const SETTINGS_ACTIONS: readonly AnyAction[] = [
  defineAction({
    id: SETTINGS_ACTION_IDS.show,
    title: "Settings…",
    category: "App",
    icon: "settings",
    shortcut: "Mod+,",
    run: () => useSettingsDialog.getState().show(),
  }),
  defineAction({
    id: SETTINGS_ACTION_IDS.zoomIn,
    title: "Increase Editor Font Size",
    category: "Editor",
    shortcut: "Mod+=",
    shortcutRegion: "editor",
    run: () => zoom(ZOOM_STEP_PX),
  }),
  defineAction({
    id: SETTINGS_ACTION_IDS.zoomOut,
    title: "Decrease Editor Font Size",
    category: "Editor",
    // Collapse All keeps Mod+- in the Database pane; the regions never overlap (decision 027).
    shortcut: "Mod+-",
    shortcutRegion: "editor",
    run: () => zoom(-ZOOM_STEP_PX),
  }),
  defineAction({
    id: SETTINGS_ACTION_IDS.zoomReset,
    title: "Reset Editor Font Size",
    category: "Editor",
    shortcut: "Mod+0",
    shortcutRegion: "editor",
    run: () =>
      useSettings.getState().update((settings) => {
        const reset = DEFAULT_SETTINGS.appearance.fonts.editor.sizePx;
        const editor = settings.appearance.fonts.editor;
        if (editor.sizePx === reset) return settings;
        return zoomEditorFont(settings, reset - editor.sizePx);
      }),
  }),
];
