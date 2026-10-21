/** The colours every surface draws from (decision 012). Plan 001 ships the Dark set alone. */
/** Mirrors `DATASOURCE_COLORS` in the bridge; a datasource stores the name, the theme the value. */
export type DatasourceTint = "red" | "orange" | "yellow" | "green" | "blue" | "violet";

export interface ColorTokens {
  readonly canvas: string;
  readonly panel: string;
  readonly raised: string;
  readonly border: string;
  readonly ink: string;
  readonly inkMuted: string;
  readonly accent: string;
  readonly accentInk: string;
  readonly danger: string;
  /** A healthy state: the connected datasource's dot. */
  readonly success: string;
  readonly gridStripe: string;
  /** The pressed stripe button and the hovered row; one step above `panel`. */
  readonly selection: string;
  /** The tints a datasource can carry (decision 011): its swatch, tab and console border. */
  readonly datasource: Readonly<Record<DatasourceTint, string>>;
}

export interface FontToken {
  readonly family: string;
  readonly sizePx: number;
}

export interface FontTokens {
  readonly ui: FontToken;
  readonly editor: FontToken;
  readonly grid: FontToken;
}

export interface DensityTokens {
  readonly rowHeightPx: number;
  readonly cellPaddingPx: number;
  readonly gapPx: number;
  readonly gridColumnMaxWidthPx: number;
  readonly consoleHeightPx: number;
  /** The tool-window stripes at either edge of the window. */
  readonly stripeWidthPx: number;
  readonly tabHeightPx: number;
  readonly statusBarHeightPx: number;
  readonly iconPx: number;
  readonly paletteWidthPx: number;
  /** The Data Sources dialog. */
  readonly dialogWidthPx: number;
  readonly dialogHeightPx: number;
  /** The datasource list inside it. */
  readonly dialogListWidthPx: number;
}

export interface Appearance {
  readonly colors: ColorTokens;
  readonly fonts: FontTokens;
  readonly density: DensityTokens;
}

const SYSTEM_UI_FONT = `system-ui, -apple-system, "Segoe UI", sans-serif`;
const SYSTEM_MONO_FONT = `"JetBrains Mono", Menlo, Consolas, monospace`;

/** Darcula-like. */
export const DARK_COLORS: ColorTokens = {
  canvas: "#1e1f22",
  panel: "#2b2d30",
  raised: "#393b40",
  border: "#43454a",
  ink: "#dfe1e5",
  inkMuted: "#9da0a8",
  accent: "#3574f0",
  accentInk: "#ffffff",
  danger: "#f75464",
  success: "#5fb865",
  gridStripe: "#26282b",
  selection: "#2e436e",
  datasource: {
    red: "#c75450",
    orange: "#d08b46",
    yellow: "#c9ae4a",
    green: "#5e9f62",
    blue: "#4f80c9",
    violet: "#9670c7",
  },
};

export const DEFAULT_FONTS: FontTokens = {
  ui: { family: SYSTEM_UI_FONT, sizePx: 13 },
  editor: { family: SYSTEM_MONO_FONT, sizePx: 13 },
  grid: { family: SYSTEM_MONO_FONT, sizePx: 12 },
};

export const COMFORTABLE_DENSITY: DensityTokens = {
  rowHeightPx: 24,
  cellPaddingPx: 8,
  gapPx: 8,
  gridColumnMaxWidthPx: 320,
  consoleHeightPx: 128,
  stripeWidthPx: 36,
  tabHeightPx: 32,
  statusBarHeightPx: 24,
  iconPx: 16,
  paletteWidthPx: 576,
  dialogWidthPx: 880,
  dialogHeightPx: 580,
  dialogListWidthPx: 240,
};

export const DEFAULT_APPEARANCE: Appearance = {
  colors: DARK_COLORS,
  fonts: DEFAULT_FONTS,
  density: COMFORTABLE_DENSITY,
};
