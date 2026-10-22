import { describe, expect, it } from "vitest";
import { formatCell, groupDigits, RAW_FORMATS, type CellFormats } from "@table-craft/desktop/renderer/grid/format.js";
import { columnChars, HEADER_EXTRA_CHARS, widerChars } from "@table-craft/desktop/renderer/grid/widths.js";

const GROUPED: CellFormats = { nullText: "∅", groupDigits: true };

describe("cell formats", () => {
  it("givenPlainNumbers_whenGrouped_thenCommaEveryThreeIntegerDigits", () => {
    expect(groupDigits("1234567")).toBe("1,234,567");
    expect(groupDigits("-1234.5")).toBe("-1,234.5");
    expect(groupDigits("123")).toBe("123");
    expect(groupDigits("1000.000001")).toBe("1,000.000001");
  });

  it("givenTextThatIsNotAPlainNumber_whenGrouped_thenDrawnAsPrinted", () => {
    for (const text of ["1e10", "NaN", "Infinity", "-Infinity", "1.5E+20", "12 345", "+1234", ".5"]) {
      expect(groupDigits(text)).toBe(text);
    }
  });

  it("givenEachValueKind_whenFormattedWithGrouping_thenOnlyNumericClassesGroup", () => {
    expect(formatCell(1234567, "integer", GROUPED)).toBe("1,234,567");
    expect(formatCell({ kind: "bigint", value: "9007199254740993" }, "integer", GROUPED)).toBe("9,007,199,254,740,993");
    expect(formatCell("-98765.4321", "decimal", GROUPED)).toBe("-98,765.4321");
    expect(formatCell(1e21, "float", GROUPED)).toBe("1e+21");
    expect(formatCell("12345", "text", GROUPED)).toBe("12345");
    expect(formatCell(null, "integer", GROUPED)).toBe("∅");
  });

  it("givenNoFormats_whenFormatted_thenTheDatabaseText", () => {
    expect(formatCell(1234567)).toBe("1234567");
    expect(formatCell(null)).toBe(RAW_FORMATS.nullText);
    expect(formatCell(1234567, "integer", { nullText: "∅", groupDigits: false })).toBe("1234567");
  });

  it("givenGrouping_whenWidthsMeasured_thenTheySeeTheSeparators", () => {
    const columns = [{ name: "n", type: "int8" }];
    const rows = [[1_234_567]];

    expect(1 + HEADER_EXTRA_CHARS).toBeLessThan("1,234,567".length);
    expect(columnChars(columns, rows, ["integer"], GROUPED)).toEqual(["1,234,567".length]);
    expect(columnChars(columns, rows, ["integer"], RAW_FORMATS)).toEqual([1 + HEADER_EXTRA_CHARS]);
    expect(widerChars([7], rows, ["integer"], GROUPED)).toEqual([9]);
    expect(widerChars([7], rows, ["integer"], RAW_FORMATS)).toEqual([7]);
    expect(widerChars([2], [[null]], ["integer"], { nullText: "(nothing)", groupDigits: false })).toEqual([9]);
  });
});
