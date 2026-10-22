import type { ColumnMeta, Relation } from "@table-craft/plugin-api";
import { defaultKeyword, quoteIdentifierWith, SQL_KEYWORDS, sqlGenerator } from "@table-craft/plugin-api/sql";
import { describe, expect, it } from "vitest";

const GENERATOR = sqlGenerator({
  quoteIdentifier: quoteIdentifierWith('"'),
  updateDefault: defaultKeyword,
  plainIdentifier: /^[a-z_][a-z0-9_$]*$/,
  keywords: SQL_KEYWORDS,
});

/** SQLite's rule: no DEFAULT in SET, so the default expression stands in. */
const EXPRESSION_DEFAULTS = sqlGenerator({
  quoteIdentifier: quoteIdentifierWith('"'),
  updateDefault: (expression) => expression ?? "NULL",
  plainIdentifier: /^[A-Za-z_][A-Za-z0-9_$]*$/,
  keywords: SQL_KEYWORDS,
});

function column(name: string, position: number, overrides: Partial<ColumnMeta> = {}): ColumnMeta {
  return {
    name,
    position,
    type: "integer",
    nullable: true,
    default: null,
    comment: null,
    autoIncrement: false,
    ...overrides,
  };
}

function relation(name: string, columns: readonly ColumnMeta[], overrides: Partial<Relation> = {}): Relation {
  return {
    name,
    kind: "table",
    comment: null,
    columns,
    primaryKey: null,
    uniqueKeys: [],
    foreignKeys: [],
    indexes: [],
    ...overrides,
  };
}

const ORDERS = relation(
  "orders",
  [column("id", 1, { nullable: false }), column("customer_id", 2), column("total", 3), column("placed_at", 4)],
  { primaryKey: { name: "orders_pkey", columns: ["id"] } },
);

const EDIT_PROBE = relation(
  "edit_probe",
  [
    column("id", 1, { autoIncrement: true, default: "nextval('edit_probe_id_seq'::regclass)" }),
    column("label", 2, { default: "'new'::text" }),
    column("qty", 3, { default: "1" }),
    column("note", 4),
  ],
  { primaryKey: { name: "edit_probe_pkey", columns: ["id"] } },
);

describe("sqlGenerator", () => {
  it("givenTable_whenGeneratingSelect_thenListsColumnsInTableOrder", () => {
    expect(GENERATOR.generate("select", ORDERS, '"public"."orders"')).toBe(
      'SELECT id, customer_id, total, placed_at\nFROM "public"."orders";',
    );
  });

  it("givenNameNeedingQuotes_whenGenerating_thenQuoted", () => {
    const awkward = relation("Line Items", [column("id", 1), column("Unit Price", 2), column("order", 3)]);

    expect(GENERATOR.generate("select", awkward, '"public"."Line Items"')).toBe(
      'SELECT id, "Unit Price", "order"\nFROM "public"."Line Items";',
    );
  });

  it("givenAutoIncrementColumn_whenGeneratingInsert_thenOmitted", () => {
    expect(GENERATOR.generate("insert", EDIT_PROBE, "edit_probe")).toMatch(
      /^INSERT INTO edit_probe \(label, qty, note\)\n/,
    );
  });

  it("givenColumnWithDefault_whenGeneratingInsert_thenUsesUpdateDefault", () => {
    expect(GENERATOR.generate("insert", EDIT_PROBE, "edit_probe")).toBe(
      "INSERT INTO edit_probe (label, qty, note)\nVALUES (DEFAULT, DEFAULT, NULL);",
    );
    expect(EXPRESSION_DEFAULTS.generate("insert", EDIT_PROBE, "edit_probe")).toBe(
      "INSERT INTO edit_probe (label, qty, note)\nVALUES ('new'::text, 1, NULL);",
    );
  });

  it("givenPrimaryKey_whenGeneratingUpdate_thenWhereOnKeyColumns", () => {
    expect(GENERATOR.generate("update", ORDERS, "orders")).toBe(
      "UPDATE orders\nSET customer_id = NULL,\n    total = NULL,\n    placed_at = NULL\nWHERE id = NULL;",
    );
  });

  it("givenCompositeKey_whenGeneratingUpdate_thenWhereJoinsKeyColumnsWithAnd", () => {
    const keyed = relation("pairs", [column("a", 1), column("b", 2), column("c", 3)], {
      primaryKey: { name: "pairs_pkey", columns: ["a", "b"] },
    });

    expect(GENERATOR.generate("update", keyed, "pairs")).toBe(
      "UPDATE pairs\nSET c = NULL\nWHERE a = NULL\n  AND b = NULL;",
    );
  });

  it("givenKeylessTable_whenGeneratingUpdate_thenWhereOnEveryColumn", () => {
    const keyless = relation("no_key_probe", [column("label", 1), column("seen", 2)]);

    expect(GENERATOR.generate("update", keyless, "no_key_probe")).toBe(
      "UPDATE no_key_probe\nSET label = NULL,\n    seen = NULL\nWHERE label = NULL\n  AND seen = NULL;",
    );
  });

  it("givenTableOfOnlyKeyColumns_whenGeneratingUpdate_thenSetsTheKeyColumns", () => {
    const allKey = relation("tags", [column("id", 1)], { primaryKey: { name: "tags_pkey", columns: ["id"] } });

    expect(GENERATOR.generate("update", allKey, "tags")).toBe("UPDATE tags\nSET id = NULL\nWHERE id = NULL;");
  });

  it("givenView_whenGeneratingDrop_thenDropView", () => {
    expect(GENERATOR.generate("drop", relation("customer_totals", [], { kind: "view" }), "customer_totals")).toBe(
      "DROP VIEW customer_totals;",
    );
    expect(GENERATOR.generate("drop", relation("totals", [], { kind: "materializedView" }), "totals")).toBe(
      "DROP MATERIALIZED VIEW totals;",
    );
    expect(GENERATOR.generate("drop", ORDERS, '"public"."orders"')).toBe('DROP TABLE "public"."orders";');
  });
});
