import type { HistoryRun } from "@table-craft/core";
import type { Datasource, PluginInfo } from "@table-craft/desktop/preload/bridge.js";
import { isSecretKey, type Redactor } from "./redact.js";
import type { ZipEntry } from "./zip.js";

/** Plan 017 decision 10: the newest history rows the export carries, as metadata. */
export const DIAGNOSTICS_HISTORY_RUNS = 50;
export const DIAGNOSTICS_FILE_PREFIX = "table-craft-diagnostics-";
export const DIAGNOSTICS_EXTENSION = ".zip";

const LOGS_FOLDER = "logs/";
const JSON_INDENT = 2;

export interface DiagnosticsSources {
  readonly logs: readonly { readonly name: string; readonly text: string }[];
  readonly about: unknown;
  /** `settings.json` as it is on disk; null when the user never saved a setting. */
  readonly settings: string | null;
  readonly datasources: readonly Datasource[];
  readonly plugins: readonly PluginInfo[];
  readonly runs: readonly HistoryRun[];
  readonly redactor: Redactor;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** `table-craft-diagnostics-<yyyyMMdd-HHmmss>.zip`, in local time like the user's clock. */
export function diagnosticsFileName(date: Date): string {
  const day = `${String(date.getFullYear())}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${DIAGNOSTICS_FILE_PREFIX}${day}-${time}${DIAGNOSTICS_EXTENSION}`;
}

/** A datasource as the export shows it: every field the manifest marks secret or password, and any secret-looking key, dropped. */
export function reducedDatasource(datasource: Datasource, plugin: PluginInfo | undefined): Datasource {
  const secret = new Set(
    (plugin?.fields ?? []).filter((field) => field.secret === true || field.kind === "password").map((f) => f.key),
  );
  const config = Object.fromEntries(
    Object.entries(datasource.config).filter(([key]) => !secret.has(key) && !isSecretKey(key)),
  );
  return { ...datasource, config };
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, JSON_INDENT)}\n`;
}

/** The zip's entries; the redaction pass runs over every text once more on the way in. */
export function diagnosticsEntries(sources: DiagnosticsSources): ZipEntry[] {
  const encode = (text: string) => new TextEncoder().encode(sources.redactor.text(text));
  const pluginOf = (id: string) => sources.plugins.find((plugin) => plugin.id === id);
  const datasources = sources.datasources.map((datasource) =>
    reducedDatasource(datasource, pluginOf(datasource.pluginId)),
  );
  return [
    ...sources.logs.map((log) => ({ name: `${LOGS_FOLDER}${log.name}`, data: encode(log.text) })),
    { name: "about.json", data: encode(json(sources.redactor.value(sources.about))) },
    ...(sources.settings === null ? [] : [{ name: "settings.json", data: encode(sources.settings) }]),
    { name: "datasources.json", data: encode(json({ datasources })) },
    {
      name: "history.json",
      data: encode(
        json({ runs: sources.runs.map((run) => ({ ...run, startedAt: new Date(run.startedAt).toISOString() })) }),
      ),
    },
  ];
}
