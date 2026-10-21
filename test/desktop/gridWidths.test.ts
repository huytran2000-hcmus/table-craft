import { describe, expect, it } from "vitest";
import {
  columnChars,
  displayChars,
  HEADER_EXTRA_CHARS,
  widerChars,
} from "@table-craft/desktop/renderer/grid/widths.js";

describe("grid column widths", () => {
  it("givenCjkAndEmoji_whenMeasured_thenEachCountsTwoCells", () => {
    expect(displayChars("héllo, 世界 🌍")).toBe(14);
  });

  it("givenAsciiAndAccents_whenMeasured_thenEachCountsOneCell", () => {
    expect(displayChars("héllo")).toBe(5);
  });

  it("givenCellsWiderThanHeader_whenMeasured_thenWidestFormattedCellWins", () => {
    const columns = [
      { name: "id", type: "int4" },
      { name: "doc", type: "jsonb" },
    ];
    const rows = [
      [1, { kind: "json" as const, text: '{"a": 1, "b": 2}' }],
      [null, null],
    ];

    expect(columnChars(columns, rows)).toEqual([2 + HEADER_EXTRA_CHARS, 16]);
  });

  it("givenNoRows_whenMeasured_thenHeaderWins", () => {
    expect(
      columnChars(
        [
          { name: "x", type: null },
          { name: "unicode_text", type: null },
        ],
        [],
      ),
    ).toEqual([1 + HEADER_EXTRA_CHARS, 12 + HEADER_EXTRA_CHARS]);
  });

  it("givenLaterWindowWithWiderNumbers_whenWidened_thenOnlyThatColumnGrows", () => {
    const chars = [8, 20];

    expect(widerChars(chars, [[49_994, "short"]])).toEqual([8, 20]);
    expect(widerChars(chars, [[123_456_789, "short"]])).toEqual([9, 20]);
  });

  it("givenNothingWider_whenWidened_thenSameArray", () => {
    const chars = [8, 20];

    expect(widerChars(chars, [[1, "x"]])).toBe(chars);
  });
});
