import type { ConsoleSession, DatasourceState } from "@table-craft/desktop/renderer/state/consoles.js";

const MS_PER_SECOND = 1000;

/** `12 ms` under a second, `1.4 s` above, as DataGrip's Services window shows a run. */
export function formatDuration(ms: number): string {
  if (ms < MS_PER_SECOND) return `${Math.round(ms)} ms`;
  return `${(ms / MS_PER_SECOND).toFixed(1)} s`;
}

export type ServiceState = "connecting" | "idle" | "running" | "failed";

/** A console as the Services window lists it. */
export function serviceState(console: ConsoleSession): ServiceState {
  if (console.status === "connecting") return "connecting";
  if (console.status === "running") return "running";
  if (console.status === "failed" || console.lastRun?.outcome === "failed") return "failed";
  return "idle";
}

const DATASOURCE_STATE_TEXT = { connecting: "connecting…", connected: "connected", failed: "failed" } as const;
const UNNAMED_DATASOURCE = "Datasource";

/** The status bar's left item: "PostgreSQL · connected", or the connect error when it failed. */
export function datasourceText(datasource: DatasourceState): string {
  if (datasource.status === "failed" && datasource.error !== null) return datasource.error.message;
  return `${datasource.pluginName ?? UNNAMED_DATASOURCE} · ${DATASOURCE_STATE_TEXT[datasource.status]}`;
}

export function datasourceName(datasource: DatasourceState): string {
  return datasource.pluginName ?? UNNAMED_DATASOURCE;
}
