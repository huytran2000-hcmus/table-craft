import type { ExplainedPlan, PlanNode, Row } from "@table-craft/plugin-api";
import { CREATE_TABLE_AS } from "@table-craft/plugin-api/sql";

/**
 * What has a query plan in SQLite. `EXPLAIN QUERY PLAN` accepts any statement, but answers nothing
 * for the rest, which would show an empty tree.
 */
export const EXPLAIN_VERBS = ["SELECT", "VALUES", "INSERT", "REPLACE", "UPDATE", "DELETE", CREATE_TABLE_AS];

export function explainStatement(sql: string): string {
  return `EXPLAIN QUERY PLAN ${sql}`;
}

/** The columns `EXPLAIN QUERY PLAN` answers: `id, parent, notused, detail`. */
const ID = 0;
const PARENT = 1;
const DETAIL = 3;
const TOP = 0;

type Mutable = Omit<PlanNode, "children"> & { children: Mutable[] };

/** Drawn the way the `sqlite3` shell prints a query plan. */
function drawn(roots: readonly PlanNode[]): string {
  const lines = ["QUERY PLAN"];
  const draw = (nodes: readonly PlanNode[], indent: string): void => {
    nodes.forEach((node, index) => {
      const last = index === nodes.length - 1;
      lines.push(`${indent}${last ? "`--" : "|--"}${node.operation}`);
      draw(node.children, `${indent}${last ? "   " : "|  "}`);
    });
  };
  draw(roots, "");
  return lines.join("\n");
}

/** Reads `EXPLAIN QUERY PLAN` rows: each names its parent's id, and `detail` says what it does. */
export function readPlanRows(rows: readonly Row[], statement: string): ExplainedPlan {
  const byId = new Map<number, Mutable>();
  const roots: Mutable[] = [];
  for (const row of rows) {
    const detail = row[DETAIL];
    const node: Mutable = {
      operation: typeof detail === "string" ? detail : "",
      target: null,
      detail: null,
      estimatedRows: null,
      estimatedCost: null,
      actualRows: null,
      actualTimeMs: null,
      loops: null,
      properties: [],
      children: [],
    };
    const parent = byId.get(Number(row[PARENT]));
    if (Number(row[PARENT]) === TOP || parent === undefined) roots.push(node);
    else parent.children.push(node);
    byId.set(Number(row[ID]), node);
  }
  return { statement, analyzed: false, roots, summary: [], raw: drawn(roots) };
}
