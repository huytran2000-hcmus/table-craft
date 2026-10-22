import { classifyTokens, transactionEffect } from "@table-craft/plugin-api/sql";
import { describe, expect, it } from "vitest";

describe("classifyTokens", () => {
  it("givenExplainAnalyzeDeleteWithoutWhere_whenClassified_thenDestructive", () => {
    expect(classifyTokens("EXPLAIN ANALYZE DELETE FROM orders")).toEqual({
      kind: "write",
      destructive: "EXPLAIN ANALYZE runs it: DELETE without WHERE",
    });
    expect(classifyTokens("explain analyse verbose update orders set total = 0").destructive).toBe(
      "EXPLAIN ANALYZE runs it: UPDATE without WHERE",
    );
    expect(classifyTokens("EXPLAIN ANALYZE FORMAT=TREE DELETE FROM orders").kind).toBe("write");
    expect(classifyTokens("DESC ANALYZE DELETE FROM orders").destructive).toMatch(/^EXPLAIN ANALYZE runs it/);
    expect(classifyTokens("EXPLAIN ANALYZE DELETE FROM orders WHERE id = 1")).toEqual({
      kind: "write",
      destructive: null,
    });
  });

  it("givenExplainDeleteWithoutWhere_whenClassified_thenReadNotDestructive", () => {
    expect(classifyTokens("EXPLAIN DELETE FROM orders")).toEqual({ kind: "read", destructive: null });
    expect(classifyTokens("EXPLAIN FORMAT=JSON DROP TABLE orders")).toEqual({ kind: "read", destructive: null });
    expect(classifyTokens("EXPLAIN QUERY PLAN DELETE FROM orders")).toEqual({ kind: "read", destructive: null });
    expect(classifyTokens("DESC orders")).toEqual({ kind: "read", destructive: null });
  });

  it("givenExplainParenthesisedAnalyze_whenClassified_thenInnerKind", () => {
    expect(classifyTokens("EXPLAIN (ANALYZE, FORMAT JSON) DELETE FROM orders").destructive).toBe(
      "EXPLAIN ANALYZE runs it: DELETE without WHERE",
    );
    expect(classifyTokens("EXPLAIN (FORMAT JSON, ANALYZE) UPDATE orders SET total = 0").kind).toBe("write");
    expect(classifyTokens("EXPLAIN (ANALYZE TRUE) SELECT 1")).toEqual({ kind: "read", destructive: null });
    expect(classifyTokens("EXPLAIN (ANALYZE on, BUFFERS) TRUNCATE orders").destructive).toBe(
      "EXPLAIN ANALYZE runs it: TRUNCATE",
    );
  });

  it("givenExplainAnalyzeFalse_whenClassified_thenRead", () => {
    expect(classifyTokens("EXPLAIN (ANALYZE FALSE) DELETE FROM orders")).toEqual({ kind: "read", destructive: null });
    expect(classifyTokens("EXPLAIN (ANALYZE off, FORMAT JSON) DELETE FROM orders").kind).toBe("read");
    expect(classifyTokens("EXPLAIN (ANALYZE 0) DELETE FROM orders").kind).toBe("read");
  });

  it("givenSelect_whenClassified_thenReadAndNotDestructive", () => {
    expect(classifyTokens("select * from orders where id = 1")).toEqual({ kind: "read", destructive: null });
  });

  it("givenDeleteWithoutWhere_whenClassified_thenDestructive", () => {
    expect(classifyTokens("DELETE FROM orders")).toEqual({ kind: "write", destructive: "DELETE without WHERE" });
    expect(classifyTokens("DELETE FROM orders WHERE id = 1")).toEqual({ kind: "write", destructive: null });
  });

  it("givenDeleteWithLimitButNoWhere_whenClassified_thenDestructiveAndSaysLimitDoesNotHelp", () => {
    expect(classifyTokens("DELETE FROM orders LIMIT 1").destructive).toMatch(/^DELETE without WHERE \(LIMIT/);
  });

  it("givenUpdateWithWhereInSubqueryOnly_whenClassified_thenDestructive", () => {
    const sql = "UPDATE orders SET total = (SELECT max(total) FROM orders o WHERE o.id = 1)";

    expect(classifyTokens(sql)).toEqual({ kind: "write", destructive: "UPDATE without WHERE" });
  });

  it("givenWhereInsideStringOrComment_whenClassified_thenStillDestructive", () => {
    expect(classifyTokens("UPDATE orders SET note = 'where' -- where\n").destructive).toBe("UPDATE without WHERE");
  });

  it("givenUpdateWithWhere_whenClassified_thenWriteAndNotDestructive", () => {
    expect(classifyTokens("UPDATE orders SET total = total + 1 WHERE id = 1")).toEqual({
      kind: "write",
      destructive: null,
    });
  });

  it("givenDropTable_whenClassified_thenDdlAndDestructive", () => {
    expect(classifyTokens("drop table orders")).toEqual({ kind: "ddl", destructive: "DROP TABLE" });
  });

  it("givenTruncate_whenClassified_thenDdlAndDestructive", () => {
    expect(classifyTokens("TRUNCATE TABLE orders")).toEqual({ kind: "ddl", destructive: "TRUNCATE" });
  });

  it("givenCreateTable_whenClassified_thenDdlAndNotDestructive", () => {
    expect(classifyTokens("CREATE TABLE t (id int)")).toEqual({ kind: "ddl", destructive: null });
  });

  it("givenCteFollowedByDelete_whenClassified_thenWriteJudgedOnTheDelete", () => {
    const sql = "WITH old AS (SELECT id FROM orders WHERE total < 1) DELETE FROM orders";

    expect(classifyTokens(sql)).toEqual({ kind: "write", destructive: "DELETE without WHERE" });
    expect(classifyTokens("WITH x AS (SELECT 1) SELECT * FROM x").kind).toBe("read");
  });

  it.each([
    ["BEGIN", "transaction"],
    ["START TRANSACTION", "transaction"],
    ["COMMIT", "transaction"],
    ["ROLLBACK TO SAVEPOINT a", "transaction"],
    ["SET search_path TO public", "other"],
    ["/* only a comment */", "other"],
  ])("given%s_whenClassified_thenKindIs%s", (sql, kind) => {
    expect(classifyTokens(sql).kind).toBe(kind);
  });
});

describe("transactionEffect", () => {
  it.each([
    ["BEGIN", "begin"],
    ["begin transaction", "begin"],
    ["START TRANSACTION READ ONLY", "begin"],
    ["COMMIT", "end"],
    ["END", "end"],
    ["ROLLBACK", "end"],
    ["ROLLBACK TO SAVEPOINT a", null],
    ["PREPARE TRANSACTION 'x'", "end"],
    ["SAVEPOINT a", null],
    ["SELECT 1", null],
  ])("given%s_whenRead_thenEffectIs%s", (sql, effect) => {
    expect(transactionEffect(sql)).toBe(effect);
  });
});
