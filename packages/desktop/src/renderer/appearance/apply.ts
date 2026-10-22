import type { Appearance } from "@table-craft/desktop/renderer/appearance/tokens.js";

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

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
    "--tc-success": colors.success,
    "--tc-grid-stripe": colors.gridStripe,
    "--tc-grid-selection": colors.gridSelection,
    "--tc-grid-null": colors.gridNull,
    "--tc-edit-modified": colors.editModified,
    "--tc-edit-inserted": colors.editInserted,
    "--tc-edit-deleted": colors.editDeleted,
    "--tc-selection": colors.selection,
    "--tc-search-match": colors.searchMatch,
    "--tc-key-icon": colors.keyIcon,
    "--tc-warning": colors.warning,
    "--tc-statement-flash": colors.statementFlash,
    ...Object.fromEntries(Object.entries(colors.datasource).map(([name, value]) => [`--tc-ds-${name}`, value])),
    ...Object.fromEntries(Object.entries(colors.syntax).map(([name, value]) => [`--tc-syntax-${kebab(name)}`, value])),
    "--tc-font-ui": fonts.ui.family,
    "--tc-font-ui-size": `${fonts.ui.sizePx}px`,
    "--tc-font-editor": fonts.editor.family,
    "--tc-font-editor-size": `${fonts.editor.sizePx}px`,
    "--tc-font-grid": fonts.grid.family,
    "--tc-font-grid-size": `${fonts.grid.sizePx}px`,
    "--tc-row-height": `${density.rowHeightPx}px`,
    "--tc-cell-padding": `${density.cellPaddingPx}px`,
    "--tc-gap": `${density.gapPx}px`,
    "--tc-grid-column-max-width": `${density.gridColumnMaxWidthPx}px`,
    "--tc-value-panel-width": `${density.valuePanelWidthPx}px`,
    "--tc-console-height": `${density.consoleHeightPx}px`,
    "--tc-stripe-width": `${density.stripeWidthPx}px`,
    "--tc-tab-height": `${density.tabHeightPx}px`,
    "--tc-status-bar-height": `${density.statusBarHeightPx}px`,
    "--tc-icon": `${density.iconPx}px`,
    "--tc-palette-width": `${density.paletteWidthPx}px`,
    "--tc-dialog-width": `${density.dialogWidthPx}px`,
    "--tc-dialog-height": `${density.dialogHeightPx}px`,
    "--tc-dialog-list-width": `${density.dialogListWidthPx}px`,
  };
}

export function applyAppearance(appearance: Appearance, root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(appearanceVariables(appearance))) root.style.setProperty(name, value);
}
