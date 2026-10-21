import { compareCodePoints, compareValues, inferredTypeClass, typeClass } from "@table-craft/core";
import type { WireValue } from "@table-craft/plugin-api";
import { describe, expect, it } from "vitest";

function sorted(values: readonly WireValue[], columnType: string | null): WireValue[] {
  const kind = typeClass(columnType);
  return [...values].sort((a, b) => compareValues(a, b, kind));
}

describe("typeClass", () => {
  it.each([
    ["int4", "integer"],
    ["BIGINT", "integer"],
    ["float8", "float"],
    ["DOUBLE PRECISION", "float"],
    ["NUMERIC(20,4)", "decimal"],
    ["decimal unsigned", "decimal"],
    ["bool", "boolean"],
    ["timestamptz", "temporal"],
    ["jsonb", "json"],
    ["bytea", "bytes"],
    ["varbinary", "bytes"],
    ["citext", "text"],
    [null, "text"],
  ] as const)("givenTypeName_%s_whenClassified_then%s", (name, expected) => {
    expect(typeClass(name)).toBe(expected);
  });
});

describe("inferredTypeClass", () => {
  it("givenUntypedValues_whenInferred_thenFirstNonNullDecides", () => {
    expect(inferredTypeClass([null, 7, "x"])).toBe("integer");
    expect(inferredTypeClass([1.5])).toBe("float");
    expect(inferredTypeClass([{ kind: "bigint", value: "9007199254740993" }])).toBe("integer");
    expect(inferredTypeClass([{ kind: "bytes", preview: "00", length: 1 }])).toBe("bytes");
    expect(inferredTypeClass(["7"])).toBe("text");
    expect(inferredTypeClass([null])).toBe("text");
  });
});

describe("compareValues", () => {
  it("givenDecimalsBeyondDoublePrecision_whenSorted_thenExactDigitOrder", () => {
    const values = ["12345678901234567890.0002", "12345678901234567890.0001", "-0.5", "0", "-12"];

    expect(sorted(values, "numeric")).toEqual([
      "-12",
      "-0.5",
      "0",
      "12345678901234567890.0001",
      "12345678901234567890.0002",
    ]);
  });

  it("givenBigintTagsAndNumbers_whenSorted_thenNumericOrder", () => {
    const big = { kind: "bigint", value: "9007199254740993" } as const;

    expect(sorted([big, 3, -1, null], "int8")).toEqual([-1, 3, big, null]);
  });

  it("givenTextColumn_whenSorted_thenCodePointOrderNotNumeric", () => {
    expect(sorted(["10", "9", "a", "B"], "text")).toEqual(["10", "9", "B", "a"]);
  });

  it("givenAstralCharacter_whenComparedWithPrivateUseCharacter_thenCodePointOrder", () => {
    expect(compareCodePoints("\u{1F30D}", "\uE000")).toBeGreaterThan(0);
  });

  it("givenMixedSqliteValues_whenSorted_thenNumbersThenTextThenBytes", () => {
    const bytes = { kind: "bytes", preview: "00", length: 1 } as const;

    expect(sorted([bytes, "x", 2, null, 1.5], null)).toEqual([1.5, 2, "x", bytes, null]);
  });

  it("givenBooleans_whenSorted_thenFalseFirst", () => {
    expect(sorted([true, false, null], "bool")).toEqual([false, true, null]);
  });
});
