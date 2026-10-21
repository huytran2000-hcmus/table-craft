import type {
  ConfigValue,
  ConnectionField,
  DatasourceColor,
  DatasourceView,
  PluginInfo,
  SaveDatasourceRequest,
  SecretChange,
  SecretMode,
} from "@table-craft/desktop/preload/bridge.js";

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
  /** Non-secret fields: text as typed, booleans for checkboxes. */
  readonly values: Readonly<Record<string, string | boolean>>;
  readonly secretModes: Readonly<Record<string, SecretMode>>;
  /** Blank means keep (decision 020); typed means set; Clear means clear. */
  readonly secrets: Readonly<Record<string, SecretChange>>;
  readonly storedSecrets: readonly string[];
  readonly ephemeral: boolean;
  readonly dirty: boolean;
}

const KEEP: SecretChange = { action: "keep" };

export function secretFieldsOf(plugin: PluginInfo | undefined): readonly ConnectionField[] {
  return (plugin?.fields ?? []).filter((field) => field.secret === true);
}

function plainFieldsOf(plugin: PluginInfo | undefined): readonly ConnectionField[] {
  return (plugin?.fields ?? []).filter((field) => field.secret !== true);
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
  return problems;
}

function configValue(field: ConnectionField, value: string | boolean | undefined): ConfigValue | undefined {
  if (field.kind === "checkbox") return value === true;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return field.kind === "number" ? Number(value) : value;
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
