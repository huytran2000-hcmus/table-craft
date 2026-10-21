import type { EngineError, StatementKind } from "@table-craft/desktop/engine/protocol.js";
import type { DatasourceView } from "@table-craft/desktop/preload/bridge.js";
import type { ConsoleSession } from "@table-craft/desktop/renderer/state/consoles.js";
import { ENGINE_EXITED_HINT, type Connection } from "@table-craft/desktop/renderer/state/datasources.js";

const MS_PER_SECOND = 1000;

/** `12 ms` under a second, `1.4 s` above, as DataGrip's Services window shows a run. */
export function formatDuration(ms: number): string {
  if (ms < MS_PER_SECOND) return `${Math.round(ms)} ms`;
  return `${(ms / MS_PER_SECOND).toFixed(1)} s`;
}

function rows(count: number): string {
  return `${count} ${count === 1 ? "row" : "rows"}`;
}

/**
 * An Output line for a statement that ran: `3 rows retrieved in 38 ms`, `1 row affected in 12 ms`,
 * or `completed in 44 ms` for DDL and the rest, whose affected count is the driver's 0, not a fact.
 */
export function executedText(
  summary: {
    readonly columns: readonly unknown[];
    readonly rowCount: number;
    readonly truncated: boolean;
    readonly rowsAffected: number | null;
  },
  ms: number,
  kind: StatementKind,
): string {
  const took = `in ${formatDuration(ms)}`;
  if (summary.columns.length === 0) {
    if (kind !== "write" || summary.rowsAffected === null) return `completed ${took}`;
    return `${rows(summary.rowsAffected)} affected ${took}`;
  }
  const truncated = summary.truncated ? " (truncated)" : "";
  return `${rows(summary.rowCount)} retrieved${truncated} ${took}`;
}

/** The first line of a statement, as the Output log and result tooltips name it. */
export function firstLine(sql: string): string {
  return sql.trimStart().split("\n", 1)[0]?.trimEnd() ?? "";
}

export type ServiceState = "connecting" | "idle" | "running" | "failed" | "disconnected";

/** A console as the Services window lists it. */
export function serviceState(console: ConsoleSession): ServiceState {
  if (console.status === "connecting") return "connecting";
  if (console.status === "running") return "running";
  if (console.status === "disconnected") return "disconnected";
  if (console.status === "failed" || console.lastRun?.outcome === "failed") return "failed";
  return "idle";
}

const CONNECTION_TEXT = {
  disconnected: "disconnected",
  connecting: "connecting…",
  connected: "connected",
  failed: "failed",
} as const;

/** The tree's word for a connection: `failed: engine exited` when its engine crashed. */
export function connectionText(connection: Connection): string {
  if (connection.status === "failed" && connection.error?.hint === ENGINE_EXITED_HINT) return "failed: engine exited";
  return CONNECTION_TEXT[connection.status];
}

/** `PostgreSQL 17.4`, once a connect has reported a version. */
export function serverText(pluginName: string | null, connection: Connection): string | null {
  if (connection.serverVersion === null) return null;
  return pluginName === null ? connection.serverVersion : `${pluginName} ${connection.serverVersion}`;
}

/** The status bar's datasource item: `pg · connected · PostgreSQL 17.4`, or the connect error. */
export function datasourceText(datasource: DatasourceView, pluginName: string | null, connection: Connection): string {
  if (connection.status === "failed" && connection.error !== null) {
    return `${datasource.name} · ${connection.error.message}`;
  }
  const server = connection.status === "connected" ? serverText(pluginName, connection) : null;
  const parts = [datasource.name, connectionText(connection)];
  if (server !== null) parts.push(server);
  return parts.join(" · ");
}

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

/** `just now`, `2 min ago`, `3 h ago`, `2 d ago`; coarse, because the status bar ticks once a minute. */
export function relativeTime(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / MS_PER_MINUTE);
  if (minutes < 1) return "just now";
  if (minutes < MINUTES_PER_HOUR) return `${minutes} min ago`;
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) return `${hours} h ago`;
  return `${Math.floor(hours / HOURS_PER_DAY)} d ago`;
}

/** The status bar's sync item: `public synchronized (38 ms) · 2 min ago`. */
export function syncText(namespace: string, introspectedAt: number, elapsedMs: number, now: number): string {
  return `${namespace} synchronized (${formatDuration(elapsedMs)}) · ${relativeTime(introspectedAt, now)}`;
}

/** The status bar's sync item for a namespace that failed: what went wrong, then what to do. */
export function syncFailedText(namespace: string, error: EngineError): string {
  return `${namespace} failed: ${error.message} ${error.hint}`;
}

/** A console tab's label (plan 004): `console [pg]`. */
export function tabLabel(title: string, datasourceName: string | undefined): string {
  return datasourceName === undefined ? title : `${title} [${datasourceName}]`;
}
