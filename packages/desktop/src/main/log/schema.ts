import { z } from "@table-craft/plugin-api";
import { LOG_LEVELS, type LogRecord } from "@table-craft/desktop/log/record.js";

/** Plan 017 decision 8: how many records one `log.write` may carry. */
export const LOG_WRITE_BATCH = 100;
const SCOPE_CHARS = 64;

/**
 * A record from another process. Its `process` is not trusted: main sets it from the channel the
 * record arrived on, so a renderer cannot write as the engine.
 */
export const logRecordInput = z.looseObject({
  ts: z.string().max(SCOPE_CHARS),
  level: z.enum(LOG_LEVELS),
  scope: z.string().min(1).max(SCOPE_CHARS),
  msg: z.string(),
});

export const logWriteRequest = z.array(logRecordInput).max(LOG_WRITE_BATCH);

/** The record as `process` wrote it, or null when it is not one. */
export function readLogRecord(input: unknown, process: string): LogRecord | null {
  const parsed = logRecordInput.safeParse(input);
  return parsed.success ? { ...parsed.data, process } : null;
}
