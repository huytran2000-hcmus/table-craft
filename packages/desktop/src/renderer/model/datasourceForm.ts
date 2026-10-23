import type {
  ConfigValue,
  ConnectionField,
  DatasourceColor,
  DatasourceView,
  ParsedUrl,
  PluginInfo,
  SaveDatasourceRequest,
  SecretChange,
  SecretMode,
} from "@table-craft/desktop/preload/bridge.js";
import { keepAliveSecondsError, statementTimeoutSecondsError } from "@table-craft/desktop/settings/settings.js";

/** One datasource as the Data Sources dialog edits it: every input as typed, nothing saved yet. */
export interface FormDraft {
  /** The dialog's list key: the datasource id once saved, `new-<n>` before. */
  readonly key: string;
  readonly id: string | undefined;
  readonly name: string;
  readonly pluginId: string;
  readonly folder: string;
  readonly comment: string;
  readonly color: DatasourceColor | null;
  readonly readOnly: boolean;
  /** Seconds as typed; blank is the default of 30 (decision 054). */
  readonly keepAliveSeconds: string;
  /** Seconds as typed; blank follows Settings → Editor → Running. */
  readonly statementTimeoutSeconds: string;
  /** The URL row as typed or as last filled in from a pasted URL, never with its password. */
  readonly url: string;
  /** What the last pasted URL left out or set; null until one is pasted. */
  readonly urlNote: UrlNote | null;
  /** Non-secret fields: text as typed, booleans for checkboxes. */
  readonly values: Readonly<Record<string, string | boolean>>;
  readonly secretModes: Readonly<Record<string, SecretMode>>;
  /** Blank means keep (decision 020); typed means set; Clear means clear. */
  readonly secrets: Readonly<Record<string, SecretChange>>;
  readonly storedSecrets: readonly string[];
  readonly ephemeral: boolean;
  readonly dirty: boolean;
}

/** The outcome of pasting a URL, for the line under the URL row. */
export type UrlNote =
  | {
      readonly kind: "applied";
      /** Secret fields the URL filled, by label. */
      readonly secrets: readonly string[];
      readonly ignored: readonly string[];
    }
  | { readonly kind: "failed"; readonly message: string; readonly hint: string };

const KEEP: SecretChange = { action: "keep" };

export function secretFieldsOf(plugin: PluginInfo | undefined): readonly ConnectionField[] {
  return (plugin?.fields ?? []).filter((field) => field.secret === true);
}

function plainFieldsOf(plugin: PluginInfo | undefined): readonly ConnectionField[] {
  return (plugin?.fields ?? []).filter((field) => field.secret !== true);
}

function secondsInput(seconds: number | undefined): string {
  return seconds === undefined ? "" : String(seconds);
}

function inputOf(field: ConnectionField, value: ConfigValue | undefined): string | boolean {
  if (field.kind === "checkbox") return value === true;
  return value === undefined ? "" : String(value);
}

/** `base`, else `base (2)`, `base (3)`… whichever no datasource has yet. */
export function uniqueName(base: string, taken: readonly string[]): string {
  const names = new Set(taken);
  if (!names.has(base)) return base;
  for (let index = 2; ; index++) {
    const candidate = `${base} (${String(index)})`;
    if (!names.has(candidate)) return candidate;
  }
}

export function draftFromView(view: DatasourceView, plugin: PluginInfo | undefined): FormDraft {
  const values: Record<string, string | boolean> = {};
  for (const field of plainFieldsOf(plugin)) values[field.key] = inputOf(field, view.config[field.key]);
  const secrets: Record<string, SecretChange> = {};
  for (const field of secretFieldsOf(plugin)) secrets[field.key] = KEEP;
  return {
    key: view.id,
    id: view.id,
    name: view.name,
    pluginId: view.pluginId,
    folder: view.folder ?? "",
    comment: view.comment,
    color: view.color,
    readOnly: view.readOnly,
    keepAliveSeconds: secondsInput(view.keepAliveSeconds),
    statementTimeoutSeconds: secondsInput(view.statementTimeoutSeconds),
    url: "",
    urlNote: null,
    values,
    secretModes: view.secretModes,
    secrets,
    storedSecrets: view.storedSecrets,
    ephemeral: view.ephemeral,
    dirty: false,
  };
}

export function newDraft(
  key: string,
  plugin: PluginInfo,
  taken: readonly string[],
  defaultMode: SecretMode,
  folder = "",
): FormDraft {
  const values: Record<string, string | boolean> = {};
  for (const field of plainFieldsOf(plugin)) values[field.key] = inputOf(field, field.default);
  const secretModes: Record<string, SecretMode> = {};
  const secrets: Record<string, SecretChange> = {};
  for (const field of secretFieldsOf(plugin)) {
    secretModes[field.key] = defaultMode;
    secrets[field.key] = KEEP;
  }
  return {
    key,
    id: undefined,
    name: uniqueName(plugin.name, taken),
    pluginId: plugin.id,
    folder,
    comment: "",
    color: null,
    readOnly: false,
    keepAliveSeconds: "",
    statementTimeoutSeconds: "",
    url: "",
    urlNote: null,
    values,
    secretModes,
    secrets,
    storedSecrets: [],
    ephemeral: false,
    dirty: true,
  };
}

/** A copy that saves as a new datasource; secrets are not copied, so the user types them again. */
export function duplicateDraft(
  key: string,
  view: DatasourceView,
  plugin: PluginInfo | undefined,
  taken: readonly string[],
  defaultMode: SecretMode,
): FormDraft {
  const source = draftFromView(view, plugin);
  const secretModes: Record<string, SecretMode> = {};
  for (const field of secretFieldsOf(plugin)) {
    const mode = source.secretModes[field.key] ?? defaultMode;
    secretModes[field.key] = view.ephemeral ? defaultMode : mode;
  }
  return {
    ...source,
    key,
    id: undefined,
    name: uniqueName(`${view.name} copy`, taken),
    secretModes,
    storedSecrets: [],
    ephemeral: false,
    dirty: true,
  };
}

/** What stops the draft from saving, as sentences; empty when it can. */
export function draftProblems(draft: FormDraft, plugin: PluginInfo | undefined): readonly string[] {
  const problems: string[] = [];
  if (draft.name.trim() === "") problems.push("Name is required.");
  for (const field of plainFieldsOf(plugin)) {
    const value = draft.values[field.key];
    if (typeof value !== "string") continue;
    if (field.required === true && value.trim() === "") problems.push(`${field.label} is required.`);
    if (field.kind === "number" && value.trim() !== "" && !Number.isFinite(Number(value))) {
      problems.push(`${field.label} must be a number.`);
    }
  }
  const keepAlive = secondsOf(draft.keepAliveSeconds);
  if (Number.isNaN(keepAlive)) problems.push("The keepalive interval must be a whole number of seconds.");
  else if (keepAlive !== undefined) pushError(problems, keepAliveSecondsError(keepAlive));
  const timeout = secondsOf(draft.statementTimeoutSeconds);
  if (Number.isNaN(timeout)) problems.push("The statement timeout must be a whole number of seconds.");
  else if (timeout !== undefined) pushError(problems, statementTimeoutSecondsError(timeout));
  return problems;
}

function pushError(problems: string[], error: string | null): void {
  if (error !== null) problems.push(error);
}

/** Undefined when blank, NaN when not a whole number. */
function secondsOf(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

function configValue(field: ConnectionField, value: string | boolean | undefined): ConfigValue | undefined {
  if (field.kind === "checkbox") return value === true;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return field.kind === "number" ? Number(value) : value;
}

function secondsField(key: string, text: string): Record<string, number> {
  const seconds = secondsOf(text);
  return seconds === undefined || Number.isNaN(seconds) ? {} : { [key]: seconds };
}

export function toSaveRequest(draft: FormDraft, plugin: PluginInfo | undefined): SaveDatasourceRequest {
  const config: Record<string, ConfigValue> = {};
  for (const field of plainFieldsOf(plugin)) {
    const value = configValue(field, draft.values[field.key]);
    if (value !== undefined) config[field.key] = value;
  }
  const folder = draft.folder.trim();
  return {
    datasource: {
      id: draft.id,
      name: draft.name.trim(),
      pluginId: draft.pluginId,
      folder: folder === "" ? null : folder,
      color: draft.color,
      readOnly: draft.readOnly,
      ...secondsField("keepAliveSeconds", draft.keepAliveSeconds),
      ...secondsField("statementTimeoutSeconds", draft.statementTimeoutSeconds),
      comment: draft.comment,
      config,
      secretModes: draft.secretModes,
    },
    secrets: draft.secrets,
  };
}

/** The placeholder a secret input shows: whether a value is stored, and what blank means. */
export function secretPlaceholder(draft: FormDraft, key: string): string {
  const change = draft.secrets[key] ?? KEEP;
  if (change.action === "clear") return "Cleared on save";
  if (draft.storedSecrets.includes(key)) return "Saved; leave blank to keep";
  if (draft.secretModes[key] === "never") return "Asked for on every connect";
  return "";
}

/**
 * The draft with a pasted URL's fields filled in. Fields the URL does not name keep what they
 * held; a password becomes the secret field's typed value, saved by its mode (decision 020), and
 * the URL row shows the URL without it.
 */
export function applyParsedUrl(
  draft: FormDraft,
  plugin: PluginInfo | undefined,
  parsed: ParsedUrl,
  url: string,
): FormDraft {
  const values = { ...draft.values };
  for (const field of plainFieldsOf(plugin)) {
    const value = parsed.values[field.key];
    if (value !== undefined) values[field.key] = inputOf(field, value);
  }
  const secrets = { ...draft.secrets };
  const filled: string[] = [];
  for (const field of secretFieldsOf(plugin)) {
    const value = parsed.secrets[field.key];
    if (value === undefined) continue;
    secrets[field.key] = { action: "set", value };
    filled.push(field.label);
  }
  return {
    ...draft,
    values,
    secrets,
    url: filled.length === 0 ? url.trim() : withoutPassword(url.trim()),
    urlNote: { kind: "applied", secrets: filled, ignored: parsed.ignored },
    dirty: true,
  };
}

const USERINFO_PASSWORD = /^([a-z][a-z0-9+.-]*:\/\/[^:@/?#]*):[^@/?#]*@/i;
const PASSWORD_PARAM = /([?&])password=[^&#]*&?/i;
const TRAILING_SEPARATOR = /[?&](?=#|$)/;

/** The URL without the password of its userinfo or a `password=` parameter; it stays in the secret field only. */
export function withoutPassword(url: string): string {
  return url.replace(USERINFO_PASSWORD, "$1@").replace(PASSWORD_PARAM, "$1").replace(TRAILING_SEPARATOR, "");
}
