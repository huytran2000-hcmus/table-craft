/**
 * The preferences in `<userData>/settings.json` (decision 032): the type, every default and every
 * range, in one pure module main and the renderer share. Parsing is by hand, field by field, so
 * that the renderer, which never loads zod, can use it too.
 */
import {
  isBuiltInThemeId,
  type BuiltInThemeId,
  type DensityId,
  type UserThemeId,
} from "@table-craft/desktop/appearance/themes.js";

export const SETTINGS_VERSION = 1;

export type ThemeChoice = "system" | BuiltInThemeId | UserThemeId;

export interface FontSetting {
  /** `null` is the built-in stack; a family is written ahead of it, so a missing font falls back. */
  readonly family: string | null;
  readonly sizePx: number;
}

export interface FontSettings {
  readonly ui: FontSetting;
  readonly editor: FontSetting;
  readonly grid: FontSetting;
}

export interface AppearanceSettings {
  readonly theme: ThemeChoice;
  readonly density: DensityId;
  readonly fonts: FontSettings;
  /** Frame the window with the operating system's title bar; main reads it at window creation. */
  readonly systemTitleBar: boolean;
}

export interface DataSettings {
  /** What a NULL cell draws. */
  readonly nullText: string;
  /** Group the integer digits of a number column with `,`; display only. */
  readonly groupDigits: boolean;
  /** Rows a statement reads before it stops, and Fetch Next Page adds. */
  readonly pageRows: number;
  /** Rows Fetch All reads at most. */
  readonly fetchAllCap: number;
}

export interface Settings {
  readonly version: typeof SETTINGS_VERSION;
  readonly appearance: AppearanceSettings;
  readonly data: DataSettings;
}

export type FontRole = keyof FontSettings;

export interface NumberRange {
  readonly min: number;
  readonly max: number;
}

export const FONT_SIZE_RANGE: NumberRange = { min: 8, max: 32 };
export const PAGE_ROWS_RANGE: NumberRange = { min: 10, max: 10_000 };
export const FETCH_ALL_CAP_RANGE: NumberRange = { min: 1_000, max: 1_000_000 };
export const NULL_TEXT_LENGTH: NumberRange = { min: 1, max: 16 };
/** Longer than any installed family's name; guards a hand-edited file, not a real font. */
export const FONT_FAMILY_MAX_LENGTH = 128;

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  appearance: {
    theme: "system",
    density: "comfortable",
    fonts: {
      ui: { family: null, sizePx: 13 },
      editor: { family: null, sizePx: 13 },
      grid: { family: null, sizePx: 12 },
    },
    systemTitleBar: false,
  },
  data: {
    nullText: "<null>",
    groupDigits: false,
    pageRows: 500,
    fetchAllCap: 100_000,
  },
};

const DENSITY_IDS: readonly DensityId[] = ["comfortable", "compact"];
const USER_THEME_PREFIX = "user:";

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function inRange(value: unknown, range: NumberRange): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= range.min && value <= range.max;
}

export function isThemeChoice(value: unknown): value is ThemeChoice {
  if (typeof value !== "string") return false;
  if (value === "system" || isBuiltInThemeId(value)) return true;
  return value.startsWith(USER_THEME_PREFIX) && value.length > USER_THEME_PREFIX.length;
}

export function fontFamilyError(family: string): string | null {
  if (family.trim() === "") return "Enter a font family name.";
  if (family.length > FONT_FAMILY_MAX_LENGTH)
    return `A font family name is at most ${FONT_FAMILY_MAX_LENGTH} characters.`;
  // eslint-disable-next-line no-control-regex -- a control character would break the CSS font-family it is written into
  if (/[\u0000-\u001f;{}]/.test(family))
    return "A font family name cannot contain control characters, ';', '{' or '}'.";
  return null;
}

function rangeError(value: number, range: NumberRange, what: string): string | null {
  if (!Number.isInteger(value)) return `${what} must be a whole number.`;
  if (value < range.min || value > range.max) {
    return `${what} must be between ${range.min.toLocaleString("en-US")} and ${range.max.toLocaleString("en-US")}.`;
  }
  return null;
}

export function fontSizeError(sizePx: number): string | null {
  return rangeError(sizePx, FONT_SIZE_RANGE, "Font size");
}

export function pageRowsError(pageRows: number): string | null {
  return rangeError(pageRows, PAGE_ROWS_RANGE, "Page size");
}

export function fetchAllCapError(fetchAllCap: number, pageRows: number): string | null {
  const error = rangeError(fetchAllCap, FETCH_ALL_CAP_RANGE, "The Fetch All limit");
  if (error !== null) return error;
  return fetchAllCap < pageRows ? "The Fetch All limit must be at least the page size." : null;
}

export function nullTextError(nullText: string): string | null {
  if (nullText.length < NULL_TEXT_LENGTH.min || nullText.length > NULL_TEXT_LENGTH.max) {
    return `NULL text must be ${NULL_TEXT_LENGTH.min} to ${NULL_TEXT_LENGTH.max} characters.`;
  }
  return null;
}

function readFont(value: unknown, fallback: FontSetting): FontSetting {
  const font = record(value);
  const family = typeof font.family === "string" && fontFamilyError(font.family) === null ? font.family : null;
  const sizePx = inRange(font.sizePx, FONT_SIZE_RANGE) ? font.sizePx : fallback.sizePx;
  return { family, sizePx };
}

/**
 * A settings document from anything, each field on its own: a field that is missing, of the wrong
 * type or out of range reads as its default, and the others are kept (plan 013 decision 1).
 */
export function readSettings(input: unknown): Settings {
  const root = record(input);
  const appearance = record(root.appearance);
  const fonts = record(appearance.fonts);
  const data = record(root.data);
  const defaults = DEFAULT_SETTINGS;
  const pageRows = inRange(data.pageRows, PAGE_ROWS_RANGE) ? data.pageRows : defaults.data.pageRows;
  const fetchAllCap =
    inRange(data.fetchAllCap, FETCH_ALL_CAP_RANGE) && data.fetchAllCap >= pageRows
      ? data.fetchAllCap
      : Math.max(defaults.data.fetchAllCap, pageRows);
  return {
    version: SETTINGS_VERSION,
    appearance: {
      theme: isThemeChoice(appearance.theme) ? appearance.theme : defaults.appearance.theme,
      density: DENSITY_IDS.includes(appearance.density as DensityId)
        ? (appearance.density as DensityId)
        : defaults.appearance.density,
      fonts: {
        ui: readFont(fonts.ui, defaults.appearance.fonts.ui),
        editor: readFont(fonts.editor, defaults.appearance.fonts.editor),
        grid: readFont(fonts.grid, defaults.appearance.fonts.grid),
      },
      systemTitleBar:
        typeof appearance.systemTitleBar === "boolean" ? appearance.systemTitleBar : defaults.appearance.systemTitleBar,
    },
    data: {
      nullText:
        typeof data.nullText === "string" && nullTextError(data.nullText) === null
          ? data.nullText
          : defaults.data.nullText,
      groupDigits: typeof data.groupDigits === "boolean" ? data.groupDigits : defaults.data.groupDigits,
      pageRows,
      fetchAllCap,
    },
  };
}

/** The editor font size `steps` px larger, within the range; zoom saves like any other change. */
export function zoomEditorFont(settings: Settings, steps: number): Settings {
  const current = settings.appearance.fonts.editor;
  const sizePx = Math.min(FONT_SIZE_RANGE.max, Math.max(FONT_SIZE_RANGE.min, current.sizePx + steps));
  return withFont(settings, "editor", { ...current, sizePx });
}

export function withFont(settings: Settings, role: FontRole, font: FontSetting): Settings {
  return {
    ...settings,
    appearance: { ...settings.appearance, fonts: { ...settings.appearance.fonts, [role]: font } },
  };
}
