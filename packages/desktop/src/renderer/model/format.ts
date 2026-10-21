import type { DatasourceView } from "@table-craft/desktop/preload/bridge.js";
import type { ConsoleSession } from "@table-craft/desktop/renderer/state/consoles.js";
import { ENGINE_EXITED_HINT, type Connection } from "@table-craft/desktop/renderer/state/datasources.js";

const MS_PER_SECOND = 1000;

/** `12 ms` under a second, `1.4 s` above, as DataGrip's Services window shows a run. */
export function formatDuration(ms: number): string {
  if (ms < MS_PER_SECOND) return `${Math.round(ms)} ms`;
  return `${(ms / MS_PER_SECOND).toFixed(1)} s`;
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

/** A console tab's label (plan 004): `console [pg]`. */
export function tabLabel(title: string, datasourceName: string | undefined): string {
  return datasourceName === undefined ? title : `${title} [${datasourceName}]`;
}
