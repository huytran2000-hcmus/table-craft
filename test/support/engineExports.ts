import type { PluginLoadResult } from "@table-craft/core";
import { createEngine, type EngineConnection } from "@table-craft/desktop/engine/engine.js";
import type {
  DatasourceConfig,
  EngineEvent,
  EngineResponse,
  ExecutedStatement,
  ExportTask,
} from "@table-craft/desktop/engine/protocol.js";
import { RESULT_FETCH_ALL_CAP, RESULT_PAGE_ROWS } from "@table-craft/desktop/engine/protocol.js";

/** Drives one engine's export tasks the way a renderer would (plan 018). */

const PAGING = { pageRows: RESULT_PAGE_ROWS, fetchAllCap: RESULT_FETCH_ALL_CAP };
const FINAL_EVENTS = new Set(["export.done", "export.failed", "export.cancelled"]);
export const STALL_SECONDS = 120;

export interface ExportHarness {
  readonly connection: EngineConnection;
  readonly events: EngineEvent[];
  readonly finished: (taskId: string) => Promise<ExportTask>;
  /** Resolves on the first progress event of `taskId` with at least `rows` rows written. */
  readonly progressed: (taskId: string, rows: number) => Promise<ExportTask>;
  readonly close: () => Promise<void>;
}

export function exportHarness(datasource: DatasourceConfig, plugins: readonly PluginLoadResult[]): ExportHarness {
  const engine = createEngine({ datasource, plugins: [...plugins] });
  const events: EngineEvent[] = [];
  const waiting: { readonly matches: (event: EngineEvent) => boolean; readonly resolve: (task: ExportTask) => void }[] =
    [];
  const connection = engine.connect((event) => {
    events.push(event);
    for (const waiter of waiting.splice(0)) {
      if (waiter.matches(event)) waiter.resolve(event.task);
      else waiting.push(waiter);
    }
  });
  function when(matches: (event: EngineEvent) => boolean): Promise<ExportTask> {
    const seen = events.find(matches);
    if (seen !== undefined) return Promise.resolve(seen.task);
    return new Promise((resolve) => waiting.push({ matches, resolve }));
  }
  return {
    connection,
    events,
    finished: (taskId) => when((event) => event.task.taskId === taskId && FINAL_EVENTS.has(event.type)),
    progressed: (taskId, rows) =>
      when((event) => event.task.taskId === taskId && (event.task.rows >= rows || FINAL_EVENTS.has(event.type))),
    async close() {
      await connection.close();
      await engine.close();
    },
  };
}

export function resultOf<T>(response: EngineResponse): T {
  if (response.type === "engine.error") throw new Error(`unexpected engine error: ${response.error.message}`);
  return response.result as T;
}

export async function openSession(connection: EngineConnection): Promise<string> {
  return resultOf<{ sessionId: string }>(await connection.handle({ id: 1, type: "session.open" })).sessionId;
}

export async function execute(
  connection: EngineConnection,
  sessionId: string,
  sql: string,
): Promise<ExecutedStatement> {
  return resultOf<ExecutedStatement>(
    await connection.handle({ id: 2, type: "statement.execute", ...PAGING, sessionId, sql }),
  );
}

export async function startExport(
  connection: EngineConnection,
  request: Record<string, unknown>,
  stallSeconds = STALL_SECONDS,
): Promise<ExportTask> {
  return resultOf<ExportTask>(await connection.handle({ id: 3, type: "export.start", stallSeconds, ...request }));
}
