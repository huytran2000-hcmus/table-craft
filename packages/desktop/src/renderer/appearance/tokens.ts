/** The colours every surface draws from (decision 012). Plan 001 ships the Dark set alone. */
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
  readonly gridStripe: string;
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
  gridStripe: "#26282b",
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
};

export const DEFAULT_APPEARANCE: Appearance = {
  colors: DARK_COLORS,
  fonts: DEFAULT_FONTS,
  density: COMFORTABLE_DENSITY,
};
