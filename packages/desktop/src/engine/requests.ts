import { EXTRACTOR_KINDS } from "@table-craft/core";
import { TRANSACTION_MODES, z } from "@table-craft/plugin-api";
import type { EngineRequest } from "@table-craft/desktop/engine/protocol.js";

const requestId = z.number().int().nonnegative();
const handle = z.string().min(1);
const sessionId = z.string().min(1);
const namespacePath = z.array(z.string()).min(1);
const index = z.number().int().nonnegative();
const extractor = z.enum(EXTRACTOR_KINDS);
const columns = z.array(index);

/** The renderer is untrusted input: every request is parsed before it is routed. */
export const engineRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({ id: requestId, type: z.literal("session.open") }),
  z.strictObject({ id: requestId, type: z.literal("session.close"), sessionId }),
  z.strictObject({
    id: requestId,
    type: z.literal("statement.execute"),
    sessionId,
    sql: z.string(),
  }),
  z.strictObject({ id: requestId, type: z.literal("statement.cancel"), sessionId }),
  z.strictObject({ id: requestId, type: z.literal("script.split"), text: z.string() }),
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
  z.strictObject({ id: requestId, type: z.literal("result.fetchMore"), handle, all: z.boolean() }),
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
    type: z.literal("result.export"),
    handle,
    extractor,
    path: z.string().min(1),
    columns,
  }),
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
]) satisfies z.ZodType<EngineRequest>;

const idOnly = z.object({ id: requestId });

/** The id of a request that failed to parse, so its caller still hears back. */
export function readRequestId(message: unknown): number | null {
  const parsed = idOnly.safeParse(message);
  return parsed.success ? parsed.data.id : null;
}
