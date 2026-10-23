import {
  quoteIdentifierWith,
  SELECT_READ_ONLY_REASONS,
  SQL_FUNCTIONS,
  SQL_KEYWORDS,
  sqlCompleter,
  sqlSavepoints,
} from "@table-craft/plugin-api/sql";
import { describe, expect, it } from "vitest";
import { fakeCatalog } from "../support/completionCatalog.js";

const postgres = sqlCompleter({
  dialect: { dollarQuotes: true },
  identifierFolding: "lower",
  plainIdentifier: /^[a-z_][a-z0-9_$]*$/,
  quoteIdentifier: quoteIdentifierWith('"'),
  keywords: SQL_KEYWORDS,
  functions: SQL_FUNCTIONS,
});

const ORDERS = ["id", "customer_id", "total"];

function source(sql: string) {
  return postgres.selectSource(sql, fakeCatalog());
}

describe("sqlCompleter.selectSource", () => {
  it("givenSelectStarWithWhere_whenRead_thenNamesTheTableAndEveryColumn", async () => {
    await expect(source("SELECT * FROM orders WHERE total > 10 ORDER BY id LIMIT 5")).resolves.toEqual({
      kind: "table",
      path: ["table_craft", "public"],
      relation: "orders",
      columns: ORDERS,
    });
  });

  it("givenAliasedColumnsAndExpression_whenRead_thenExpressionIsNull", async () => {
    await expect(source("SELECT o.id, o.total AS amount, total * 2 AS doubled, 'x' FROM orders AS o")).resolves.toEqual(
      {
        kind: "table",
        path: ["table_craft", "public"],
        relation: "orders",
        columns: ["id", "total", null, null],
      },
    );
  });

  it("givenQualifiedTableAndQuotedColumn_whenRead_thenFoldsAsTheDialectDoes", async () => {
    await expect(source('SELECT "id", CUSTOMER_ID FROM public.orders;')).resolves.toMatchObject({
      kind: "table",
      columns: ["id", "customer_id"],
    });
  });

  it("givenUnknownColumnWord_whenRead_thenItIsAnExpression", async () => {
    await expect(source("SELECT id, current_date FROM orders")).resolves.toMatchObject({ columns: ["id", null] });
  });

  it("givenSubqueryInWhere_whenRead_thenStillOneTable", async () => {
    await expect(
      source("SELECT * FROM orders WHERE customer_id IN (SELECT id FROM customers GROUP BY id)"),
    ).resolves.toMatchObject({ kind: "table", relation: "orders" });
  });

  it.each([
    ["SELECT * FROM orders o JOIN customers c ON c.id = o.customer_id", SELECT_READ_ONLY_REASONS.joins],
    ["SELECT * FROM orders, customers", SELECT_READ_ONLY_REASONS.joins],
    ["SELECT customer_id, count(*) FROM orders GROUP BY customer_id", SELECT_READ_ONLY_REASONS.aggregates],
    ["SELECT max(total) FROM orders", SELECT_READ_ONLY_REASONS.aggregates],
    ["SELECT DISTINCT customer_id FROM orders", SELECT_READ_ONLY_REASONS.distinct],
    ["SELECT id, row_number() OVER (ORDER BY id) FROM orders", SELECT_READ_ONLY_REASONS.windows],
    ["SELECT id FROM orders UNION SELECT id FROM customers", SELECT_READ_ONLY_REASONS.combines],
    ["WITH t AS (SELECT * FROM orders) SELECT * FROM t", SELECT_READ_ONLY_REASONS.with],
    ["SELECT * FROM (SELECT * FROM orders) t", SELECT_READ_ONLY_REASONS.derived],
    ["SELECT * FROM generate_series(1, 3)", SELECT_READ_ONLY_REASONS.derived],
    ["SELECT 1", SELECT_READ_ONLY_REASONS.noTable],
    ["SELECT * FROM orders FOR UPDATE", SELECT_READ_ONLY_REASONS.notSelect],
    ["UPDATE orders SET total = 1 RETURNING *", SELECT_READ_ONLY_REASONS.notSelect],
    ["SELECT c.id FROM orders o", SELECT_READ_ONLY_REASONS.notSelect],
  ])("givenStatement_whenRead_thenReadOnlyWithReason %s", async (sql, reason) => {
    await expect(source(sql)).resolves.toEqual({ kind: "readOnly", reason });
  });

  it("givenTableTheCatalogLacks_whenRead_thenReadOnlyNamingIt", async () => {
    await expect(source("SELECT * FROM missing")).resolves.toEqual({
      kind: "readOnly",
      reason: "the catalog does not know missing",
    });
  });
});

describe("sqlSavepoints", () => {
  it("givenName_whenWritten_thenQuotesItInEachStatement", () => {
    expect(sqlSavepoints(quoteIdentifierWith("`"))("tc edit")).toEqual({
      set: "SAVEPOINT `tc edit`",
      rollback: "ROLLBACK TO SAVEPOINT `tc edit`",
      release: "RELEASE SAVEPOINT `tc edit`",
    });
  });
});
