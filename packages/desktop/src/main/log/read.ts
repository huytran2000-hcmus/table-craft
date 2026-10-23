import { readFile } from "node:fs/promises";
import { isLogLevel, type LogRecord } from "@table-craft/desktop/log/record.js";

export type ReadLogFile = (path: string) => Promise<string | null>;

export const readLogFile: ReadLogFile = async (path) => {
  try {
    return await readFile(path, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
};

export function parseRecord(line: string): LogRecord | null {
  if (line.trim() === "") return null;
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value !== "object" || value === null) return null;
    const record = value as Record<string, unknown>;
    if (!isLogLevel(record.level) || typeof record.ts !== "string" || typeof record.msg !== "string") return null;
    return {
      ...record,
      ts: record.ts,
      level: record.level,
      msg: record.msg,
      process: typeof record.process === "string" ? record.process : "unknown",
      scope: typeof record.scope === "string" ? record.scope : "unknown",
    };
  } catch {
    return null;
  }
}

/** The last `limit` records across the log files (`paths` newest first), newest first; a line that does not parse is skipped. */
export async function readRecent(paths: readonly string[], limit: number, read = readLogFile): Promise<LogRecord[]> {
  const records: LogRecord[] = [];
  for (const path of paths) {
    const text = await read(path);
    if (text === null) continue;
    const lines = text.split("\n");
    for (let index = lines.length - 1; index >= 0 && records.length < limit; index -= 1) {
      const record = parseRecord(lines[index] as string);
      if (record !== null) records.push(record);
    }
    if (records.length >= limit) break;
  }
  return records;
}
