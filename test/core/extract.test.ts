import { extract, project, type SqlDialect } from "@table-craft/core";
import type { Column, Row } from "@table-craft/plugin-api";
import { quoteIdentifierWith, sqlLiteral } from "@table-craft/plugin-api/sql";
import { describe, expect, it } from "vitest";

const COLUMNS: readonly Column[] = [
  { name: "id", type: "int4" },
  { name: "note", type: "text" },
];

const ANSI: SqlDialect = {
  quoteIdentifier: quoteIdentifierWith('"'),
  literal: (value) => sqlLiteral(value, { backslashEscapes: false, bytes: (hex) => `X'${hex}'` }),
};

describe("extractors", () => {
  it("givenFieldWithCommaQuoteNewline_whenCsv_thenRfc4180Quoted", () => {
    const rows: Row[] = [
      [1, 'say "hi", then\nleave'],
      [2, null],
      [3, "plain"],
    ];

    expect(extract("csv", COLUMNS, rows)).toBe('id,note\n1,"say ""hi"", then\nleave"\n2,\n3,plain\n');
  });

  it("givenTabsAndNewlines_whenTsv_thenEscaped", () => {
    expect(extract("tsv", COLUMNS, [[1, "a\tb\nc\\d"]])).toBe("id\tnote\n1\ta\\tb\\nc\\\\d\n");
  });

  it("givenJsonAndBigint_whenJsonExtractor_thenJsonEmbeddedBigintString", () => {
    const columns: Column[] = [
      { name: "big", type: "int8" },
      { name: "doc", type: "jsonb" },
      { name: "total", type: "numeric" },
      { name: "payload", type: "bytea" },
    ];
    const rows: Row[] = [
      [
        { kind: "bigint", value: "9007199254740993" },
        { kind: "json", text: '{"a": [1, null]}' },
        "10.50",
        { kind: "bytes", preview: "deadbeef", length: 4 },
      ],
    ];

    const text = extract("json", columns, rows);

    expect(JSON.parse(text)).toEqual([
      { big: "9007199254740993", doc: { a: [1, null] }, total: "10.50", payload: "0xdeadbeef" },
    ]);
    expect(text.startsWith("[\n  {\n")).toBe(true);
  });

  it("givenNoRows_whenJsonExtractor_thenEmptyArray", () => {
    expect(JSON.parse(extract("json", COLUMNS, []))).toEqual([]);
  });

  it("givenPipeInValue_whenMarkdown_thenEscaped", () => {
    expect(extract("markdown", COLUMNS, [[1, "a|b\nc"]])).toBe("| id | note |\n| --- | --- |\n| 1 | a\\|b<br>c |\n");
  });

  it("givenRows_whenSqlInsert_thenOneStatementPerRowWithDialectQuoting", () => {
    const rows: Row[] = [
      [1, "it's"],
      [2, null],
    ];

    expect(extract("sqlInsert", COLUMNS, rows, { dialect: ANSI })).toBe(
      `INSERT INTO MY_TABLE ("id", "note") VALUES (1, 'it''s');\nINSERT INTO MY_TABLE ("id", "note") VALUES (2, NULL);\n`,
    );
  });

  it("givenNoDialect_whenSqlInsert_thenInvalidRequest", () => {
    expect(() => extract("sqlInsert", COLUMNS, [])).toThrow(
      expect.objectContaining({ code: "invalidRequest" }) as Error,
    );
  });

  it("givenHiddenColumn_whenExtracted_thenOmitted", () => {
    const visible = [1];
    const rows = [[1, "kept"]].map((row) => project(row, visible));

    expect(
      extract(
        "csv",
        visible.map((index) => COLUMNS[index] as Column),
        rows,
      ),
    ).toBe("note\nkept\n");
  });

  it("givenClippedBytes_whenCsv_thenMarkedClipped", () => {
    const columns: Column[] = [{ name: "payload", type: "bytea" }];

    expect(extract("csv", columns, [[{ kind: "bytes", preview: "00ff", length: 2048 }]])).toBe("payload\n0x00ff…\n");
  });
});
