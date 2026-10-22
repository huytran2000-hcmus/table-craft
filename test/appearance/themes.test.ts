import { describe, expect, it } from "vitest";
import {
  BUILT_IN_THEME_IDS,
  BUILT_IN_THEMES,
  contrastRatio,
  CONTRAST_PAIRS,
  DARK_COLORS,
  LIGHT_COLORS,
  overrideColors,
  requiredContrast,
  resolveTheme,
  type UserThemeEntry,
} from "@table-craft/desktop/appearance/themes.js";

const LIGHT_SYSTEM = { prefersDark: false, prefersMoreContrast: false };
const DARK_SYSTEM = { prefersDark: true, prefersMoreContrast: false };

describe("contrast", () => {
  it("givenBlackOnWhite_whenMeasured_thenTwentyOneToOne", () => {
    expect(contrastRatio("#000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#000000ff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
  });

  it("givenEachBuiltInTheme_whenPairsMeasured_thenMeetTheirContrast", () => {
    const failures = BUILT_IN_THEME_IDS.flatMap((id) =>
      CONTRAST_PAIRS.flatMap((pair) => {
        const [foreground, background] = pair.pick(BUILT_IN_THEMES[id].colors);
        const ratio = contrastRatio(foreground, background);
        const required = requiredContrast(id, pair.kind);
        return ratio >= required
          ? []
          : [`${id}: ${pair.foreground} on ${pair.background} is ${ratio.toFixed(2)}, needs ${String(required)}`];
      }),
    );

    expect(failures).toEqual([]);
  });
});

describe("theme resolution", () => {
  const userThemes: UserThemeEntry[] = [
    {
      id: "user:solar",
      name: "Solar",
      base: "light",
      colors: overrideColors(LIGHT_COLORS, { canvas: "#fdf6e3", syntax: { keyword: "#859900" } }),
    },
    { id: "user:broken", file: "broken.json", errors: ["colors.canvas: not a colour"] },
  ];

  it("givenUserThemeOverridingTwoTokens_whenResolved_thenRestComeFromBase", () => {
    const { theme, notice } = resolveTheme("user:solar", DARK_SYSTEM, userThemes);

    expect(notice).toBeNull();
    expect(theme.colorScheme).toBe("light");
    expect(theme.colors).toEqual({
      ...LIGHT_COLORS,
      canvas: "#fdf6e3",
      syntax: { ...LIGHT_COLORS.syntax, keyword: "#859900" },
    });
  });

  it("givenSystemChoice_whenSystemChanges_thenFollowsSchemeAndContrast", () => {
    expect(resolveTheme("system", LIGHT_SYSTEM, []).theme.id).toBe("light");
    expect(resolveTheme("system", DARK_SYSTEM, []).theme.id).toBe("dark");
    expect(resolveTheme("system", { prefersDark: false, prefersMoreContrast: true }, []).theme.id).toBe("highContrast");
  });

  it("givenChosenUserThemeBrokenOrGone_whenResolved_thenDarkWithNotice", () => {
    const broken = resolveTheme("user:broken", LIGHT_SYSTEM, userThemes);
    const gone = resolveTheme("user:gone", LIGHT_SYSTEM, userThemes);

    expect(broken.theme.colors).toBe(DARK_COLORS);
    expect(broken.notice).toContain("broken.json");
    expect(gone.theme.colors).toBe(DARK_COLORS);
    expect(gone.notice).toContain("gone");
  });
});
