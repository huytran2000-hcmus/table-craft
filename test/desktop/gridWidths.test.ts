import { describe, expect, it } from "vitest";
import { columnChars, columnTemplate, displayChars } from "@table-craft/desktop/renderer/grid/widths.js";

describe("grid column widths", () => {
  it("givenCjkAndEmoji_whenMeasured_thenEachCountsTwoCells", () => {
    expect(displayChars("héllo, 世界 🌍")).toBe(14);
  });

  it("givenAsciiAndAccents_whenMeasured_thenEachCountsOneCell", () => {
    expect(displayChars("héllo")).toBe(5);
  });

  it("givenCellsWiderThanName_whenMeasured_thenWidestFormattedCellWins", () => {
    const columns = [
      { name: "id", type: "int4" },
      { name: "doc", type: "jsonb" },
    ];
    const rows = [
      [1, { kind: "json" as const, text: '{"a": 1}' }],
      [null, null],
    ];

    expect(columnChars(columns, rows)).toEqual([6, 8]);
  });

  it("givenNoRows_whenMeasured_thenNameOrMinimumWins", () => {
    expect(
      columnChars(
        [
          { name: "x", type: null },
          { name: "unicode_text", type: null },
        ],
        [],
      ),
    ).toEqual([4, 12]);
  });

  it("givenChars_whenTemplated_thenEachTrackIsCappedByTheDensityToken", () => {
    expect(columnTemplate([4])).toBe("min(var(--spacing-column-max), calc(4ch + 2 * var(--spacing-cell) + 1px))");
  });
});
