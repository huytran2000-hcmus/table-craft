import { sqlSplitter } from "@table-craft/plugin-api/sql";
import { describe, expect, it } from "vitest";

const plain = sqlSplitter();
const postgres = sqlSplitter({ dollarQuotes: true, nestedBlockComments: true, blockKeywords: ["BEGIN"] });
const mysql = sqlSplitter({
  backslashEscapes: true,
  delimiterCommand: true,
  hashComments: true,
  blockKeywords: ["BEGIN"],
});
const sqlite = sqlSplitter({ blockKeywords: ["BEGIN"] });

function statements(split: (text: string) => readonly { sql: string }[], text: string): string[] {
  return split(text).map((span) => span.sql);
}

describe("sqlSplitter", () => {
  it("givenThreeStatements_whenSplit_thenSpansCoverEachWithoutDelimiter", () => {
    const text =
      "SELECT * FROM customers;\nUPDATE orders SET total = total + 1 WHERE id = 1;\nSELECT count(*) FROM orders;";

    const spans = plain(text);

    expect(spans.map((span) => span.sql)).toEqual([
      "SELECT * FROM customers",
      "UPDATE orders SET total = total + 1 WHERE id = 1",
      "SELECT count(*) FROM orders",
    ]);
    for (const span of spans) expect(text.slice(span.from, span.to)).toBe(span.sql);
  });

  it("givenSemicolonInsideString_whenSplit_thenOneStatement", () => {
    expect(statements(plain, "SELECT 'a;b', 'it''s; fine' FROM t; SELECT 2")).toEqual([
      "SELECT 'a;b', 'it''s; fine' FROM t",
      "SELECT 2",
    ]);
  });

  it("givenSemicolonInsideQuotedIdentifier_whenSplit_thenOneStatement", () => {
    expect(statements(plain, 'SELECT 1 AS "a;b", 2 AS `c;d`; SELECT 3')).toEqual([
      'SELECT 1 AS "a;b", 2 AS `c;d`',
      "SELECT 3",
    ]);
  });

  it("givenSemicolonInsideLineAndBlockComment_whenSplit_thenOneStatement", () => {
    expect(statements(plain, "SELECT 1 -- not; here\n, 2 /* nor; here */ FROM t; SELECT 3")).toEqual([
      "SELECT 1 -- not; here\n, 2 /* nor; here */ FROM t",
      "SELECT 3",
    ]);
  });

  it("givenCommentsBetweenStatements_whenSplit_thenTheyBelongToNoStatement", () => {
    const text = "SELECT 1;\n-- a note\n/* another */\nSELECT 2;";

    expect(plain(text).map((span) => span.from)).toEqual([0, text.indexOf("SELECT 2")]);
  });

  it("givenEmptyStatements_whenSplit_thenDropped", () => {
    expect(statements(plain, ";;  ; SELECT 1;; -- only a comment\n; /* and this */ ;")).toEqual(["SELECT 1"]);
    expect(plain("   \n ")).toEqual([]);
  });

  it("givenNoTrailingDelimiter_whenSplit_thenLastStatementRunsToItsLastToken", () => {
    expect(statements(plain, "SELECT 1;\nSELECT 2  \n  ")).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("givenAstralCharacters_whenSplit_thenOffsetsAreUtf16", () => {
    const text = "SELECT '🌍'; SELECT '世界'";

    const spans = plain(text);

    expect(spans[1]).toEqual({ from: 13, to: 24, sql: "SELECT '世界'" });
    expect(spans[0]?.to).toBe("SELECT '🌍'".length);
  });

  it("givenDollarQuotedFunctionBody_whenSplitAsPostgres_thenOneStatement", () => {
    const body = "CREATE FUNCTION f() RETURNS int AS $body$ BEGIN RETURN 1; END; $body$ LANGUAGE plpgsql";

    expect(statements(postgres, `${body};\nSELECT f();`)).toEqual([body, "SELECT f()"]);
    expect(statements(postgres, "DO $$ BEGIN PERFORM 1; END $$; SELECT 2")).toEqual([
      "DO $$ BEGIN PERFORM 1; END $$",
      "SELECT 2",
    ]);
  });

  it("givenPositionalParameter_whenSplitAsPostgres_thenNotADollarQuote", () => {
    expect(statements(postgres, "SELECT $1; SELECT a$b$ FROM t; SELECT 3")).toEqual([
      "SELECT $1",
      "SELECT a$b$ FROM t",
      "SELECT 3",
    ]);
  });

  it("givenNestedBlockComment_whenSplitAsPostgres_thenOneComment", () => {
    expect(statements(postgres, "/* outer /* inner; */ still; */ SELECT 1; SELECT 2")).toEqual([
      "SELECT 1",
      "SELECT 2",
    ]);
  });

  it("givenEscapeString_whenSplitAsPostgres_thenBackslashEscapesTheQuote", () => {
    expect(statements(postgres, "SELECT E'it\\'s;'; SELECT 2")).toEqual(["SELECT E'it\\'s;'", "SELECT 2"]);
  });

  it("givenBeginAtomicBody_whenSplitAsPostgres_thenOneStatement", () => {
    const create =
      "CREATE FUNCTION one() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; SELECT CASE WHEN true THEN 1 END; END";

    expect(statements(postgres, `${create};\nBEGIN;\nSELECT 2;\nCOMMIT;`)).toEqual([
      create,
      "BEGIN",
      "SELECT 2",
      "COMMIT",
    ]);
  });

  it("givenBackslashEscapedQuote_whenSplitAsMysql_thenOneStatement", () => {
    expect(statements(mysql, "SELECT 'it\\'s;'; SELECT \"a\\\";\"; SELECT 3")).toEqual([
      "SELECT 'it\\'s;'",
      'SELECT "a\\";"',
      "SELECT 3",
    ]);
  });

  it("givenHashComment_whenSplitAsMysql_thenIgnored", () => {
    expect(statements(mysql, "# a; note\nSELECT 1; # trailing; note\nSELECT 2")).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("givenDelimiterCommand_whenSplitAsMysql_thenUsesNewDelimiter", () => {
    const text = [
      "DELIMITER //",
      "CREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END//",
      "DELIMITER ;",
      "CALL p();",
      "DELIMITER $$",
      "CREATE FUNCTION f() RETURNS int DETERMINISTIC BEGIN RETURN 1; END$$",
    ].join("\n");

    expect(statements(mysql, text)).toEqual([
      "CREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END",
      "CALL p()",
      "CREATE FUNCTION f() RETURNS int DETERMINISTIC BEGIN RETURN 1; END",
    ]);
  });

  it("givenProcedureBodyWithoutDelimiter_whenSplitAsMysql_thenBodyStaysWhole", () => {
    const create =
      "CREATE PROCEDURE p() BEGIN IF 1 THEN SELECT 1; END IF; WHILE 0 DO SELECT 2; END WHILE; CASE WHEN 1 THEN SELECT 3; END CASE; END";

    expect(statements(mysql, `${create};\nBEGIN;\nCOMMIT`)).toEqual([create, "BEGIN", "COMMIT"]);
  });

  it("givenTriggerBody_whenSplitAsSqlite_thenOneStatement", () => {
    const trigger =
      "CREATE TRIGGER t AFTER INSERT ON orders BEGIN UPDATE customers SET name = name WHERE id = NEW.customer_id; SELECT CASE WHEN 1 THEN 1 END; END";

    expect(statements(sqlite, `${trigger};\nSELECT 1;`)).toEqual([trigger, "SELECT 1"]);
  });

  it("givenColumnNamedBegin_whenSplit_thenNoBodyOpens", () => {
    expect(statements(sqlite, "CREATE TABLE t (begin int); SELECT 1")).toEqual([
      "CREATE TABLE t (begin int)",
      "SELECT 1",
    ]);
    expect(statements(sqlite, "SELECT begin FROM t; SELECT 2")).toEqual(["SELECT begin FROM t", "SELECT 2"]);
  });

  it("givenUnterminatedString_whenSplit_thenRestIsOneStatement", () => {
    expect(statements(plain, "SELECT 1; SELECT 'open; SELECT 3")).toEqual(["SELECT 1", "SELECT 'open; SELECT 3"]);
  });
});
