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
  /** Behind the grid's selected cells; stronger than `selection`, which marks hover. */
  readonly gridSelection: string;
  /** A NULL cell's `<null>`, set in italics so it never reads as the string (plan 007 decision 16). */
  readonly gridNull: string;
  /** Behind a table editor cell whose pending value differs from the database's (plan 008 decision 10). */
  readonly editModified: string;
  /** Behind a row added in the table editor and not yet submitted. */
  readonly editInserted: string;
  /** Behind a row marked for deletion, whose text is also struck through. */
  readonly editDeleted: string;
  /** The pressed stripe button and the hovered row; one step above `panel`. */
  readonly selection: string;
  /** Behind the characters speed search matched in a tree row. */
  readonly searchMatch: string;
  /** A primary or unique key's glyph in the Database pane; foreign keys use `accent`. */
  readonly keyIcon: string;
  /** Something to look at that is not a failure: a skipped statement, a cancelled run. */
  readonly warning: string;
  /** Behind the statement the console just ran, fading out (plan 006 decision 7). */
  readonly statementFlash: string;
  /** The tints a datasource can carry (decision 011): its swatch, tab and console border. */
  readonly datasource: Readonly<Record<DatasourceTint, string>>;
  readonly syntax: SyntaxColorTokens;
}

/** The SQL editor's highlighting; anything without a token draws in `ink`. */
export interface SyntaxColorTokens {
  readonly keyword: string;
  readonly string: string;
  readonly number: string;
  readonly comment: string;
  /** Quoted identifiers: `"order"`, `` `order` ``. */
  readonly identifier: string;
  readonly operator: string;
  /** Bind parameters and variables: `$1`, `:name`, `@var`. */
  readonly variable: string;
  readonly bracketMatch: string;
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
  /** The result grid's value panel, beside its rows. */
  readonly valuePanelWidthPx: number;
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
  /** Quick Documentation's popover, at most this big; its columns list scrolls. */
  readonly popoverWidthPx: number;
  readonly popoverHeightPx: number;
  /** The SQL Generator dialog. */
  readonly generatorWidthPx: number;
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
  gridSelection: "#214283",
  gridNull: "#7c7f87",
  editModified: "#2f4a6b",
  editInserted: "#2f4d34",
  editDeleted: "#4d2f33",
  selection: "#2e436e",
  searchMatch: "#6b5a1e",
  keyIcon: "#d9a343",
  warning: "#e0a84a",
  statementFlash: "#3d4a2e",
  datasource: {
    red: "#c75450",
    orange: "#d08b46",
    yellow: "#c9ae4a",
    green: "#5e9f62",
    blue: "#4f80c9",
    violet: "#9670c7",
  },
  syntax: {
    keyword: "#cf8e6d",
    string: "#6aab73",
    number: "#2aacb8",
    comment: "#7a7e85",
    identifier: "#c77dbb",
    operator: "#bcbec4",
    variable: "#56a8f5",
    bracketMatch: "#43454a",
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
  valuePanelWidthPx: 360,
  consoleHeightPx: 128,
  stripeWidthPx: 36,
  tabHeightPx: 32,
  statusBarHeightPx: 24,
  iconPx: 16,
  paletteWidthPx: 576,
  dialogWidthPx: 880,
  dialogHeightPx: 580,
  dialogListWidthPx: 240,
  popoverWidthPx: 480,
  popoverHeightPx: 360,
  generatorWidthPx: 640,
};

export const DEFAULT_APPEARANCE: Appearance = {
  colors: DARK_COLORS,
  fonts: DEFAULT_FONTS,
  density: COMFORTABLE_DENSITY,
};
