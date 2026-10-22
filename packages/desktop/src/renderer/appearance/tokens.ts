import {
  DEFAULT_FONTS,
  DENSITIES,
  type Appearance,
  type FontToken,
  type Theme,
} from "@table-craft/desktop/appearance/themes.js";
import type { FontSetting, Settings } from "@table-craft/desktop/settings/settings.js";

export * from "@table-craft/desktop/appearance/themes.js";

function quoteFamily(family: string): string {
  return `"${family.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** A chosen family goes ahead of the built-in stack, so a font that is gone falls back to it. */
export function fontStack(family: string | null, builtIn: string): string {
  return family === null ? builtIn : `${quoteFamily(family)}, ${builtIn}`;
}

function fontOf(setting: FontSetting, builtIn: FontToken): FontToken {
  return { family: fontStack(setting.family, builtIn.family), sizePx: setting.sizePx };
}

/** The tokens the settings and the resolved theme draw with. */
export function appearanceOf(settings: Settings, theme: Theme): Appearance {
  const { fonts, density } = settings.appearance;
  return {
    colors: theme.colors,
    fonts: {
      ui: fontOf(fonts.ui, DEFAULT_FONTS.ui),
      editor: fontOf(fonts.editor, DEFAULT_FONTS.editor),
      grid: fontOf(fonts.grid, DEFAULT_FONTS.grid),
    },
    density: DENSITIES[density],
  };
}
