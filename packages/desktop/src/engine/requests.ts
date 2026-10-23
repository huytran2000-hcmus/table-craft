import { EXPORT_FORMATS, EXTRACTOR_KINDS } from "@table-craft/core";
import { GENERATED_STATEMENTS, KEYWORD_CASES, TRANSACTION_MODES, z } from "@table-craft/plugin-api";
import type { EngineRequest } from "@table-craft/desktop/engine/protocol.js";
import {
  EXPORT_STALL_SECONDS_RANGE,
  FETCH_ALL_CAP_RANGE,
  INDENT_WIDTH_RANGE,
  LINES_BETWEEN_STATEMENTS_RANGE,
  PAGE_ROWS_RANGE,
} from "@table-craft/desktop/settings/settings.js";

const requestId = z.number().int().nonnegative();
const handle = z.string().min(1);
const sessionId = z.string().min(1);
const namespacePath = z.array(z.string()).min(1);
const index = z.number().int().nonnegative();
const extractor = z.enum(EXTRACTOR_KINDS);
const columns = z.array(index);
const relation = z.string().min(1);
const taskId = z.string().min(1);
const stallSeconds = z.number().int().min(EXPORT_STALL_SECONDS_RANGE.min).max(EXPORT_STALL_SECONDS_RANGE.max);
const exportSource = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("result"), handle, columns }),
  z.strictObject({ kind: z.literal("table"), path: namespacePath, relation, columns: z.array(z.string().min(1)) }),
]);
const GENERATOR_STATEMENTS = ["create", ...GENERATED_STATEMENTS] as const;
const paging = {
  pageRows: z.number().int().min(PAGE_ROWS_RANGE.min).max(PAGE_ROWS_RANGE.max),
  fetchAllCap: z.number().int().min(FETCH_ALL_CAP_RANGE.min).max(FETCH_ALL_CAP_RANGE.max),
};
const cellInput = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("text"), text: z.string() }),
  z.strictObject({ kind: z.literal("null") }),
  z.strictObject({ kind: z.literal("default") }),
]);
const edits = z.array(
  z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("update"),
      row: index,
      values: z.array(z.strictObject({ column: index, value: cellInput })),
    }),
    z.strictObject({ kind: z.literal("insert"), values: z.array(cellInput) }),
    z.strictObject({ kind: z.literal("delete"), row: index }),
  ]),
);

/** The renderer is untrusted input: every request is parsed before it is routed. */
export const engineRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({ id: requestId, type: z.literal("session.open") }),
  z.strictObject({ id: requestId, type: z.literal("session.close"), sessionId }),
  z.strictObject({
    id: requestId,
    type: z.literal("statement.execute"),
    sessionId,
    sql: z.string(),
    parameters: z.record(z.string(), z.string().nullable()).optional(),
    ...paging,
  }),
  z.strictObject({ id: requestId, type: z.literal("statement.cancel"), sessionId }),
  z.strictObject({ id: requestId, type: z.literal("script.split"), text: z.string() }),
  z.strictObject({
    id: requestId,
    type: z.literal("sql.format"),
    text: z.string(),
    options: z.strictObject({
      keywordCase: z.enum(KEYWORD_CASES),
      indentWidth: z.number().int().min(INDENT_WIDTH_RANGE.min).max(INDENT_WIDTH_RANGE.max),
      linesBetweenStatements: z
        .number()
        .int()
        .min(LINES_BETWEEN_STATEMENTS_RANGE.min)
        .max(LINES_BETWEEN_STATEMENTS_RANGE.max),
    }),
  }),
  z.strictObject({ id: requestId, type: z.literal("sql.explainable"), sql: z.string(), analyze: z.boolean() }),
  z.strictObject({
    id: requestId,
    type: z.literal("statement.explain"),
    sessionId,
    sql: z.string(),
    analyze: z.boolean(),
  }),
  z.strictObject({
    id: requestId,
    type: z.literal("transaction.setMode"),
    sessionId,
    mode: z.enum(TRANSACTION_MODES),
  }),
  z.strictObject({ id: requestId, type: z.literal("transaction.commit"), sessionId }),
  z.strictObject({ id: requestId, type: z.literal("transaction.rollback"), sessionId }),
  z.strictObject({
    id: requestId,
    type: z.literal("result.window"),
    handle,
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
  }),
  z.strictObject({ id: requestId, type: z.literal("result.release"), handle }),
  z.strictObject({ id: requestId, type: z.literal("result.fetchMore"), handle, all: z.boolean(), ...paging }),
  z.strictObject({ id: requestId, type: z.literal("result.stopFetch"), handle }),
  z.strictObject({
    id: requestId,
    type: z.literal("result.sort"),
    handle,
    keys: z.array(z.strictObject({ column: index, direction: z.enum(["asc", "desc"]) })),
  }),
  z.strictObject({
    id: requestId,
    type: z.literal("result.extract"),
    handle,
    extractor,
    rows: z.array(z.strictObject({ from: index, to: index })),
    columns,
  }),
  z.strictObject({
    id: requestId,
    type: z.literal("export.start"),
    source: exportSource,
    format: z.enum(EXPORT_FORMATS),
    path: z.string().min(1),
    stallSeconds,
  }),
  z.strictObject({ id: requestId, type: z.literal("export.cancel"), taskId }),
  z.strictObject({ id: requestId, type: z.literal("export.retry"), taskId, stallSeconds }),
  z.strictObject({ id: requestId, type: z.literal("export.list") }),
  z.strictObject({ id: requestId, type: z.literal("catalog.namespaces"), refresh: z.boolean().optional() }),
  z.strictObject({
    id: requestId,
    type: z.literal("catalog.describe"),
    path: namespacePath,
    refresh: z.boolean().optional(),
  }),
  z.strictObject({
    id: requestId,
    type: z.literal("catalog.qualifiedName"),
    path: namespacePath,
    name: z.string().min(1),
  }),
  z.strictObject({ id: requestId, type: z.literal("catalog.definition"), path: namespacePath, name: relation }),
  z.strictObject({
    id: requestId,
    type: z.literal("sql.generate"),
    path: namespacePath,
    name: relation,
    statement: z.enum(GENERATOR_STATEMENTS),
  }),
  z.strictObject({
    id: requestId,
    type: z.literal("table.query"),
    sessionId,
    path: namespacePath,
    relation,
    where: z.string(),
    orderBy: z.string(),
    ...paging,
  }),
  z.strictObject({ id: requestId, type: z.literal("table.count"), path: namespacePath, relation, where: z.string() }),
  z.strictObject({
    id: requestId,
    type: z.literal("table.condition"),
    handle,
    rows: z.array(index).min(1),
    columns: z.array(z.strictObject({ column: index, name: z.string().min(1) })).min(1),
  }),
  z.strictObject({
    id: requestId,
    type: z.literal("completion.complete"),
    text: z.string(),
    offset: index,
    scope: z.strictObject({ path: namespacePath, relation }).optional(),
    current: namespacePath.optional(),
  }),
  z.strictObject({
    id: requestId,
    type: z.literal("navigation.resolve"),
    text: z.string(),
    offset: index,
    current: namespacePath.optional(),
  }),
  z.strictObject({
    id: requestId,
    type: z.literal("table.orderBy"),
    terms: z.array(z.strictObject({ name: z.string().min(1), direction: z.enum(["asc", "desc"]) })),
  }),
  z.strictObject({ id: requestId, type: z.literal("edits.preview"), handle, edits }),
  z.strictObject({ id: requestId, type: z.literal("edits.submit"), sessionId, handle, edits }),
]) satisfies z.ZodType<EngineRequest>;

const idOnly = z.object({ id: requestId });

/** The id of a request that failed to parse, so its caller still hears back. */
export function readRequestId(message: unknown): number | null {
  const parsed = idOnly.safeParse(message);
  return parsed.success ? parsed.data.id : null;
}
