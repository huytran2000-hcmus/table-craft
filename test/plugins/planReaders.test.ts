import { readFileSync } from "node:fs";
import type { PlanNode, Row } from "@table-craft/plugin-api";
import { readJson, readTree } from "@table-craft/plugin-mysql/explain";
import { readPlan } from "@table-craft/plugin-postgres/explain";
import { readPlanRows } from "@table-craft/plugin-sqlite/explain";
import { describe, expect, it } from "vitest";

/** Captured from the `test:db` containers (postgres:17, mysql:8.4) and node:sqlite on the fixture schema. */
function captured(name: string): string {
  return readFileSync(new URL(`../support/plans/${name}`, import.meta.url), "utf8").trimEnd();
}

function shape(node: PlanNode): unknown {
  return { operation: node.operation, children: node.children.map(shape) };
}

describe("plan readers", () => {
  it("givenPostgresJson_whenRead_thenNestedNodesAndSummary", () => {
    const plan = readPlan(captured("postgres-explain.json"), "EXPLAIN (FORMAT JSON) …", false);
    expect(plan.roots.map(shape)).toEqual([
      {
        operation: "Nested Loop",
        children: [
          { operation: "Seq Scan", children: [] },
          { operation: "Index Scan", children: [] },
        ],
      },
    ]);
    const [scan, lookup] = plan.roots[0]?.children ?? [];
    expect(scan).toMatchObject({ target: "orders o", estimatedRows: 2, estimatedCost: 1.04, actualRows: null });
    expect(scan?.properties).toContainEqual({ name: "Filter", value: "(total > '10'::numeric)" });
    expect(lookup).toMatchObject({ target: "customers c", detail: "using customers_pkey" });
    expect(lookup?.properties).toContainEqual({ name: "Index Cond", value: "(id = o.customer_id)" });
    expect(lookup?.properties.map((property) => property.name)).not.toContain("Index Name");
    expect(plan.summary).toEqual([]);
  });

  it("givenPostgresAnalysedJson_whenRead_thenActualsAndTimesInSummary", () => {
    const plan = readPlan(captured("postgres-analyze.json"), "EXPLAIN (ANALYZE, FORMAT JSON) …", true);
    expect(plan.roots[0]).toMatchObject({ actualRows: 2, loops: 1, actualTimeMs: 0.036 });
    expect(plan.roots[0]?.children[1]).toMatchObject({ actualRows: 1, loops: 2 });
    expect(plan.summary).toEqual([
      { name: "Planning Time", value: "1.029 ms" },
      { name: "Execution Time", value: "0.057 ms" },
    ]);
  });

  it("givenMysqlTree_whenRead_thenDepthFromIndent", () => {
    const plan = readTree(captured("mysql-explain.txt"), "EXPLAIN FORMAT=TREE …", false);
    expect(plan.roots.map(shape)).toEqual([
      {
        operation: "Nested loop inner join",
        children: [
          { operation: "Filter", children: [{ operation: "Table scan on o", children: [] }] },
          { operation: "Single-row index lookup on c using PRIMARY (id=o.customer_id)", children: [] },
        ],
      },
    ]);
    expect(plan.roots[0]).toMatchObject({ estimatedCost: 0.9, estimatedRows: 1, actualRows: null });
    expect(plan.roots[0]?.children[0]?.detail).toBe("(o.total > 10.00)");
  });

  it("givenMysqlAnalysedTree_whenRead_thenActualTimeRowsAndLoops", () => {
    const plan = readTree(captured("mysql-analyze.txt"), "EXPLAIN ANALYZE FORMAT=TREE …", true);
    expect(plan.roots[0]).toMatchObject({ actualTimeMs: 0.193, actualRows: 2, loops: 1 });
    expect(plan.roots[0]?.children[1]).toMatchObject({ actualTimeMs: 0.0244, actualRows: 1, loops: 2 });
    const update = readTree(
      "-> Update o (immediate)  (actual time=0.00508..0.00508 rows=0 loops=1)\n" +
        "    -> Rows fetched before execution  (cost=0..0 rows=1) (actual time=125e-6..125e-6 rows=1 loops=1)",
      "",
      true,
    );
    expect(update.roots[0]).toMatchObject({ operation: "Update o (immediate)", estimatedCost: null, loops: 1 });
    expect(update.roots[0]?.children[0]).toMatchObject({ estimatedCost: 0, actualTimeMs: 0.000125 });
  });

  it("givenMysqlUpdateJson_whenRead_thenOneUpdateStepWithItsCondition", () => {
    const plan = readJson(captured("mysql-update.json"), "EXPLAIN FORMAT=JSON …");
    expect(plan.roots).toHaveLength(1);
    expect(plan.roots[0]).toMatchObject({
      operation: "Update",
      target: "orders",
      detail: "range access using PRIMARY",
      estimatedRows: 1,
    });
    expect(plan.roots[0]?.properties).toContainEqual({
      name: "attached_condition",
      value: "(`table_craft`.`orders`.`id` = 1)",
    });
  });

  it("givenSqliteRows_whenRead_thenTreeFromParent", () => {
    const { rows } = JSON.parse(captured("sqlite-view.json")) as { rows: Row[] };
    const plan = readPlanRows(rows, "EXPLAIN QUERY PLAN …");
    expect(plan.roots.map(shape)).toEqual([
      {
        operation: "CO-ROUTINE customer_totals",
        children: [
          { operation: "SCAN c", children: [] },
          { operation: "BLOOM FILTER ON o (customer_id=?)", children: [] },
          { operation: "SEARCH o USING AUTOMATIC COVERING INDEX (customer_id=?) LEFT-JOIN", children: [] },
        ],
      },
      { operation: "SCAN customer_totals", children: [] },
    ]);
    expect(plan.raw.split("\n")).toEqual([
      "QUERY PLAN",
      "|--CO-ROUTINE customer_totals",
      "|  |--SCAN c",
      "|  |--BLOOM FILTER ON o (customer_id=?)",
      "|  `--SEARCH o USING AUTOMATIC COVERING INDEX (customer_id=?) LEFT-JOIN",
      "`--SCAN customer_totals",
    ]);
  });
});
