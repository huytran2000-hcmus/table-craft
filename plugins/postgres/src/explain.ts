import { PluginError, type ExplainedPlan, type PlanNode, type PlanProperty } from "@table-craft/plugin-api";
import { CREATE_TABLE_AS, planPropertyValue } from "@table-craft/plugin-api/sql";

/** What PostgreSQL's EXPLAIN accepts (`ExplainStmt` in `gram.y`), and it analyses all of them. */
export const EXPLAIN_VERBS = ["SELECT", "VALUES", "TABLE", "INSERT", "UPDATE", "DELETE", "MERGE", CREATE_TABLE_AS];

export function explainStatement(sql: string, analyze: boolean): string {
  return analyze ? `EXPLAIN (ANALYZE, FORMAT JSON) ${sql}` : `EXPLAIN (FORMAT JSON) ${sql}`;
}

type Json = Record<string, unknown>;

/** The keys `PlanNode` has a field for; every other key of a node becomes a property. */
const NODE_TYPE = "Node Type";
const RELATION = "Relation Name";
const ALIAS = "Alias";
const INDEX = "Index Name";
const TOTAL_COST = "Total Cost";
const PLAN_ROWS = "Plan Rows";
const ACTUAL_TIME = "Actual Total Time";
const ACTUAL_ROWS = "Actual Rows";
const ACTUAL_LOOPS = "Actual Loops";
const CHILDREN = "Plans";
const MAPPED = new Set([
  NODE_TYPE,
  RELATION,
  ALIAS,
  INDEX,
  TOTAL_COST,
  PLAN_ROWS,
  ACTUAL_TIME,
  ACTUAL_ROWS,
  ACTUAL_LOOPS,
  CHILDREN,
]);
const PLAN = "Plan";
/** PostgreSQL reports every time in milliseconds, under a key ending in `Time`. */
const TIME_KEY = / Time$/;
const MILLISECONDS = " ms";

function isJson(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function properties(json: Json, skip: ReadonlySet<string>): PlanProperty[] {
  return Object.entries(json).flatMap(([name, value]) => {
    if (skip.has(name)) return [];
    const shown = planPropertyValue(value);
    if (shown === null) return [];
    return [{ name, value: TIME_KEY.test(name) && typeof value === "number" ? `${shown}${MILLISECONDS}` : shown }];
  });
}

function planNode(json: Json): PlanNode {
  const relation = text(json[RELATION]);
  const alias = text(json[ALIAS]);
  const index = text(json[INDEX]);
  const children = Array.isArray(json[CHILDREN]) ? json[CHILDREN].filter(isJson) : [];
  return {
    operation: text(json[NODE_TYPE]) ?? PLAN,
    target: relation === null ? alias : alias === null || alias === relation ? relation : `${relation} ${alias}`,
    detail: index === null ? null : `using ${index}`,
    estimatedRows: number(json[PLAN_ROWS]),
    estimatedCost: number(json[TOTAL_COST]),
    actualRows: number(json[ACTUAL_ROWS]),
    actualTimeMs: number(json[ACTUAL_TIME]),
    loops: number(json[ACTUAL_LOOPS]),
    properties: properties(json, MAPPED),
    children: children.map(planNode),
  };
}

const PLAN_KEYS = new Set([PLAN]);

/** Reads what `EXPLAIN (FORMAT JSON)` printed: a list holding one object, its `Plan` and summary. */
export function readPlan(raw: string, statement: string, analyzed: boolean): ExplainedPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new PluginError("statementFailed", "PostgreSQL printed a plan that is not JSON; run the EXPLAIN with Run.", {
      cause,
    });
  }
  const entries = (Array.isArray(parsed) ? parsed : [parsed]).filter(isJson);
  return {
    statement,
    analyzed,
    roots: entries.flatMap((entry) => (isJson(entry[PLAN]) ? [planNode(entry[PLAN])] : [])),
    summary: entries.flatMap((entry) => properties(entry, PLAN_KEYS)),
    raw,
  };
}
