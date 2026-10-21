import { BYTES_PREVIEW_LENGTH, toWireValue } from "@table-craft/plugin-api";
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
