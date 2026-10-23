import {
  CSV_FORMAT,
  CsvError,
  CsvReader,
  DecodeError,
  TSV_FORMAT,
  extract,
  formatProblem,
  importDecoder,
  inferColumns,
  previewFile,
  type CsvRecord,
  type ImportFormat,
} from "@table-craft/core";
import type { Column, Row } from "@table-craft/plugin-api";
import { describe, expect, it } from "vitest";

/** Every record of `text` fed to the reader in slices of `size` characters. */
function readAll(text: string, format: ImportFormat = CSV_FORMAT, size = text.length): CsvRecord[] {
  const reader = new CsvReader(format);
  const records: CsvRecord[] = [];
  for (let at = 0; at < text.length; at += Math.max(1, size)) records.push(...reader.push(text.slice(at, at + size)));
  records.push(...reader.end());
  return records;
}

function fieldsOf(records: readonly CsvRecord[]): (readonly (string | null)[])[] {
  return records.map((record) => record.fields);
}

function decodeAll(bytes: Uint8Array, size: number, encoding: ImportFormat["encoding"] = "auto"): string {
  const decoder = importDecoder(encoding);
  let text = "";
  for (let at = 0; at < bytes.length; at += size) text += decoder.push(bytes.subarray(at, at + size));
  return text + decoder.end();
}

async function* chunks(bytes: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
  await Promise.resolve();
  for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size);
}

const ENCODE = new TextEncoder();

describe("import reader", () => {
  it("givenQuotedNewline_whenRead_thenOneRecord", () => {
    const records = readAll('id,note\n1,"two\nlines"\n2,plain\n');

    expect(fieldsOf(records)).toEqual([
      ["id", "note"],
      ["1", "two\nlines"],
      ["2", "plain"],
    ]);
    expect(records.map((record) => record.line)).toEqual([1, 2, 4]);
  });

  it("givenCrlfSplitAcrossChunks_whenRead_thenNoEmptyRecord", () => {
    const text = 'a,b\r\n1,"x\r\ny"\r\n2,z\r\n';

    for (let size = 1; size <= text.length; size += 1) {
      expect(fieldsOf(readAll(text, CSV_FORMAT, size))).toEqual([
        ["a", "b"],
        ["1", "x\r\ny"],
        ["2", "z"],
      ]);
    }
  });

  it("givenDoubledQuoteSplitAcrossChunks_whenRead_thenOneQuote", () => {
    const text = 'a\n"say ""hi"""\n';

    for (let size = 1; size <= text.length; size += 1) {
      expect(fieldsOf(readAll(text, CSV_FORMAT, size))).toEqual([["a"], ['say "hi"']]);
    }
  });

  it("givenLoneCarriageReturns_whenRead_thenLinesEnd", () => {
    expect(fieldsOf(readAll("a\r1\r2"))).toEqual([["a"], ["1"], ["2"]]);
  });

  it("givenBlankLines_whenRead_thenSkipped", () => {
    expect(fieldsOf(readAll("a\n\n1\n\r\n2\n\n"))).toEqual([["a"], ["1"], ["2"]]);
  });

  it("givenNullToken_whenRead_thenNullOnlyUnquoted", () => {
    expect(fieldsOf(readAll('a,b,c\n,"",x\n'))).toEqual([
      ["a", "b", "c"],
      [null, "", "x"],
    ]);
    const custom = { ...CSV_FORMAT, nullToken: "\\N" };
    expect(fieldsOf(readAll('a,b,c\n\\N,"\\N",\n', custom))).toEqual([
      ["a", "b", "c"],
      [null, "\\N", ""],
    ]);
  });

  it("givenBackslashNullToken_whenTsv_thenRawTokenIsNull", () => {
    const format = { ...TSV_FORMAT, nullToken: "\\N" };

    expect(fieldsOf(readAll("a\tb\n\\N\t\\\\N\n", format))).toEqual([
      ["a", "b"],
      [null, "\\N"],
    ]);
  });

  it("givenTrim_whenRead_thenUnquotedFieldsTrimmedOnly", () => {
    const format = { ...CSV_FORMAT, trim: true };

    expect(fieldsOf(readAll('a,b\n  x  ," y "\n', format))).toEqual([
      ["a", "b"],
      ["x", " y "],
    ]);
  });

  it("givenSemicolonAndSingleQuote_whenRead_thenSplitThere", () => {
    const format = { ...CSV_FORMAT, delimiter: ";", quote: "'" };

    expect(fieldsOf(readAll("a;b\n'x;y';'it''s'\n", format))).toEqual([
      ["a", "b"],
      ["x;y", "it's"],
    ]);
  });

  it("givenUnterminatedQuote_whenEnded_thenFailsWithLine", () => {
    expect(() => readAll('a\n1\n"open\n2\n')).toThrow(CsvError);
    expect(() => readAll('a\n1\n"open\n2\n')).toThrow(/Line 3/u);
  });

  it("givenUnterminatedQuote_whenPastLimit_thenFails", () => {
    const reader = new CsvReader(CSV_FORMAT, 10);

    expect(() => reader.push('a\n"0123456789abc')).toThrow(/runs past/u);
  });

  it("givenExporterCsv_whenRead_thenSameCells", () => {
    const columns: Column[] = [
      { name: "id", type: "int4" },
      { name: "text", type: "text" },
      { name: "missing", type: "text" },
    ];
    const rows: Row[] = [
      [1, 'comma, "quote"\nand line', null],
      [2, "plain", "x"],
    ];
    const csv = extract("csv", columns, rows);

    expect(fieldsOf(readAll(csv))).toEqual([
      ["id", "text", "missing"],
      ["1", 'comma, "quote"\nand line', null],
      ["2", "plain", "x"],
    ]);
  });

  it("givenExporterTsv_whenReadWithTsvPreset_thenSameCells", () => {
    const columns: Column[] = [
      { name: "id", type: "int4" },
      { name: "text", type: "text" },
    ];
    const rows: Row[] = [
      [1, "tab\there\nnew \\ line\r"],
      [2, null],
    ];
    const tsv = extract("tsv", columns, rows);

    for (const size of [1, 3, tsv.length]) {
      expect(fieldsOf(readAll(tsv, TSV_FORMAT, size))).toEqual([
        ["id", "text"],
        ["1", "tab\there\nnew \\ line\r"],
        ["2", null],
      ]);
    }
  });

  it("givenRaggedRows_whenRead_thenFieldsAsWritten", () => {
    expect(fieldsOf(readAll("a,b\n1\n1,2,3\n"))).toEqual([["a", "b"], ["1"], ["1", "2", "3"]]);
  });

  it("givenBadFormat_whenChecked_thenProblemNamed", () => {
    expect(formatProblem(CSV_FORMAT)).toBeNull();
    expect(formatProblem(TSV_FORMAT)).toBeNull();
    expect(formatProblem({ ...CSV_FORMAT, delimiter: "ab" })).toMatch(/one character/u);
    expect(formatProblem({ ...CSV_FORMAT, quote: "," })).toMatch(/differ/u);
  });
});

describe("import decoder", () => {
  it("givenUtf8Bom_whenDecoded_thenBomDropped", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...ENCODE.encode("é,1")]);

    for (const size of [1, 2, 64]) expect(decodeAll(bytes, size)).toBe("é,1");
  });

  it("givenUtf16LeBom_whenDecoded_thenText", () => {
    const body = Buffer.from("a;ü\n", "utf16le");
    const bytes = new Uint8Array([0xff, 0xfe, ...body]);

    for (const size of [1, 3, 64]) expect(decodeAll(bytes, size)).toBe("a;ü\n");
  });

  it("givenUtf16BeBom_whenDecodedInOddChunks_thenText", () => {
    const little = Buffer.from("x;\u4e16🌍\n", "utf16le");
    const big = Buffer.from(little).swap16();
    const bytes = new Uint8Array([0xfe, 0xff, ...big]);

    for (const size of [1, 3, 5, 64]) expect(decodeAll(bytes, size)).toBe("x;\u4e16🌍\n");
  });

  it("givenLatin1Bytes_whenAuto_thenDecodeErrorSaysChooseEncoding", () => {
    const bytes = new Uint8Array([0x61, 0xe9, 0x62]);

    expect(() => decodeAll(bytes, 64)).toThrow(DecodeError);
    expect(() => decodeAll(bytes, 64)).toThrow(/choose the file's encoding/u);
    expect(decodeAll(bytes, 64, "windows-1252")).toBe("aéb");
  });

  it("givenShortFile_whenAuto_thenDecodedAtEnd", () => {
    expect(decodeAll(ENCODE.encode("a"), 64)).toBe("a");
  });
});

describe("import inference", () => {
  it("givenSamples_whenInferred_thenNarrowestKind", () => {
    const rows = [
      ["1", "3000000000", "1.25", "1e3", "true", "2024-02-29", "2024-02-29 13:45:30", "x", null],
      ["-2", "1", "10.5", "2", "FALSE", "2024-03-01", "2024-03-01", "1", null],
    ];

    expect(inferColumns(rows, 9).map((column) => column.kind)).toEqual([
      "integer",
      "bigint",
      "decimal",
      "double",
      "boolean",
      "date",
      "timestamp",
      "text",
      "text",
    ]);
  });

  it("givenDecimals_whenInferred_thenWidestDigitsAndScale", () => {
    expect(inferColumns([["123.4"], ["1.2345"], [null]], 1)).toEqual([{ kind: "decimal", integerDigits: 3, scale: 4 }]);
  });

  it("givenLeadingZeros_whenInferred_thenText", () => {
    expect(inferColumns([["007"]], 1)[0]?.kind).toBe("text");
  });
});

describe("import preview", () => {
  it("givenFile_whenPreviewed_thenNamesRowsKindsAndRagged", async () => {
    const bytes = ENCODE.encode("id,name\n1,ann\n2\n3,bob\n");

    const preview = await previewFile(chunks(bytes, 4), CSV_FORMAT);

    expect(preview.names).toEqual(["id", "name"]);
    expect(preview.rows).toEqual([["1", "ann"], ["2"], ["3", "bob"]]);
    expect(preview.columns.map((column) => column.kind)).toEqual(["integer", "text"]);
    expect(preview.ragged).toBe(1);
    expect(preview.encoding).toBe("utf-8");
  });

  it("givenNoHeader_whenPreviewed_thenNumberedNames", async () => {
    const preview = await previewFile(chunks(ENCODE.encode("1,2\n"), 64), { ...CSV_FORMAT, header: false });

    expect(preview.names).toEqual(["column_1", "column_2"]);
    expect(preview.rows).toEqual([["1", "2"]]);
  });
});
