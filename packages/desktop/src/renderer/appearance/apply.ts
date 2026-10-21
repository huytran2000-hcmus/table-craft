import type { Appearance } from "@table-craft/desktop/renderer/appearance/tokens.js";

/** The CSS variables `app.css` maps onto Tailwind's theme. */
export function appearanceVariables(appearance: Appearance): Readonly<Record<string, string>> {
  const { colors, fonts, density } = appearance;
  return {
    "--tc-canvas": colors.canvas,
    "--tc-panel": colors.panel,
    "--tc-raised": colors.raised,
    "--tc-border": colors.border,
    "--tc-ink": colors.ink,
    "--tc-ink-muted": colors.inkMuted,
    "--tc-accent": colors.accent,
    "--tc-accent-ink": colors.accentInk,
    "--tc-danger": colors.danger,
    "--tc-grid-stripe": colors.gridStripe,
    "--tc-font-ui": fonts.ui.family,
    "--tc-font-ui-size": `${fonts.ui.sizePx}px`,
    "--tc-font-editor": fonts.editor.family,
    "--tc-font-editor-size": `${fonts.editor.sizePx}px`,
    "--tc-font-grid": fonts.grid.family,
    "--tc-font-grid-size": `${fonts.grid.sizePx}px`,
    "--tc-row-height": `${density.rowHeightPx}px`,
    "--tc-cell-padding": `${density.cellPaddingPx}px`,
    "--tc-gap": `${density.gapPx}px`,
    "--tc-grid-column-width": `${density.gridColumnWidthPx}px`,
    "--tc-console-height": `${density.consoleHeightPx}px`,
  };
}

export function applyAppearance(appearance: Appearance, root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(appearanceVariables(appearance))) root.style.setProperty(name, value);
}
