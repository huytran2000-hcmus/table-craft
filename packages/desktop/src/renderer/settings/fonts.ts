/** The families installed on this machine, monospace ones apart, or why they could not be listed. */
export type FontFamilies =
  | { readonly kind: "listed"; readonly monospace: readonly string[]; readonly proportional: readonly string[] }
  | { readonly kind: "unavailable"; readonly reason: string };

interface LocalFont {
  readonly family: string;
}

type QueryLocalFonts = () => Promise<readonly LocalFont[]>;

/** Large enough that a one-pixel rounding difference between glyphs cannot pass for equal widths. */
const PROBE_SIZE_PX = 32;
const PROBE_LENGTH = 10;
const NARROW_PROBE = "i".repeat(PROBE_LENGTH);
const WIDE_PROBE = "W".repeat(PROBE_LENGTH);

/** `measure(text, family)` in px, or null when nothing can measure. */
export type MeasureText = (text: string, family: string) => number | null;

export function canvasMeasure(): MeasureText {
  const context = document.createElement("canvas").getContext("2d");
  return (text, family) => {
    if (context === null) return null;
    context.font = `${String(PROBE_SIZE_PX)}px "${family.replaceAll('"', '\\"')}"`;
    return context.measureText(text).width;
  };
}

/** A family is monospace when `i` and `W` take the same advance. */
export function isMonospace(family: string, measure: MeasureText): boolean {
  const narrow = measure(NARROW_PROBE, family);
  const wide = measure(WIDE_PROBE, family);
  return narrow !== null && wide !== null && Math.abs(narrow - wide) < 1;
}

/** Families from `queryLocalFonts()`, deduplicated and sorted, split by `isMonospace`. */
export async function listFontFamilies(
  query: QueryLocalFonts | undefined,
  measure: MeasureText,
): Promise<FontFamilies> {
  if (query === undefined) return { kind: "unavailable", reason: "This build cannot list the installed fonts." };
  let fonts: readonly LocalFont[];
  try {
    fonts = await query();
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return { kind: "unavailable", reason: `The installed fonts could not be listed (${reason}).` };
  }
  const families = [...new Set(fonts.map((font) => font.family))].sort((a, b) => a.localeCompare(b));
  if (families.length === 0) return { kind: "unavailable", reason: "No installed fonts were listed." };
  const monospace: string[] = [];
  const proportional: string[] = [];
  for (const family of families) (isMonospace(family, measure) ? monospace : proportional).push(family);
  return { kind: "listed", monospace, proportional };
}

let installed: Promise<FontFamilies> | null = null;

/** The machine's families, listed once per window: the list is slow and does not change while it runs. */
export function installedFontFamilies(): Promise<FontFamilies> {
  const query = (window as { queryLocalFonts?: QueryLocalFonts }).queryLocalFonts?.bind(window);
  installed ??= listFontFamilies(query, canvasMeasure());
  return installed;
}
