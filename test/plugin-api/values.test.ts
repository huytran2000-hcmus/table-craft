import { BYTES_PREVIEW_LENGTH, isPluginError, PluginError, toWireInteger, toWireValue } from "@table-craft/plugin-api";
import { describe, expect, it } from "vitest";

const LARGE_BLOB_LENGTH = 100;

describe("toWireValue", () => {
  it("givenScalars_whenConverted_thenPassThrough", () => {
    expect([null, undefined, true, 1.5, "x"].map(toWireValue)).toEqual([null, null, true, 1.5, "x"]);
  });

  it("givenBigInt_whenConverted_thenTaggedAsString", () => {
    expect(toWireValue(2n ** 64n)).toEqual({ kind: "bigint", value: "18446744073709551616" });
  });

  it("givenLargeBlob_whenConverted_thenPreviewIsTruncatedAndLengthKept", () => {
    const value = toWireValue(new Uint8Array(LARGE_BLOB_LENGTH).fill(0xab));
    expect(value).toEqual({ kind: "bytes", preview: "ab".repeat(BYTES_PREVIEW_LENGTH), length: LARGE_BLOB_LENGTH });
  });

  it("givenDateAndObject_whenConverted_thenTagged", () => {
    expect(toWireValue(new Date(0))).toEqual({ kind: "date", iso: "1970-01-01T00:00:00.000Z" });
    expect(toWireValue({ a: 1 })).toEqual({ kind: "json", text: '{"a":1}' });
  });
});

describe("toWireInteger", () => {
  it("givenSafeInteger_whenConverted_thenNumber", () => {
    expect([toWireInteger("-42"), toWireInteger(BigInt(Number.MAX_SAFE_INTEGER))]).toEqual([
      -42,
      Number.MAX_SAFE_INTEGER,
    ]);
  });

  it("givenIntegerBeyondSafeRange_whenConverted_thenTagged", () => {
    expect(toWireInteger("-9007199254740993")).toEqual({ kind: "bigint", value: "-9007199254740993" });
  });
});

describe("isPluginError", () => {
  it("givenPluginError_whenChecked_thenTrue", () => {
    expect(isPluginError(new PluginError("cancelled", "stopped"))).toBe(true);
  });

  it("givenLookalikeFromAnotherBundle_whenChecked_thenTrue", () => {
    const foreign = Object.assign(new Error("stopped"), { name: "PluginError", code: "cancelled" });
    expect(isPluginError(foreign)).toBe(true);
  });

  it("givenUnknownCodeOrPlainError_whenChecked_thenFalse", () => {
    const unknownCode = Object.assign(new Error("x"), { name: "PluginError", code: "exploded" });
    expect([isPluginError(unknownCode), isPluginError(new Error("x")), isPluginError("x")]).toEqual([
      false,
      false,
      false,
    ]);
  });
});
