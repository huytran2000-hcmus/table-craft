import * as Dialog from "@radix-ui/react-dialog";
import { useId, useMemo, useState } from "react";
import type { ProbeResult } from "@table-craft/desktop/engine/protocol.js";
import {
  DATASOURCE_COLORS,
  SECRET_MODES,
  type BridgeFailure,
  type ConnectionField,
  type DatasourceView,
  type PluginInfo,
  type SecretMode,
} from "@table-craft/desktop/preload/bridge.js";
import { deleteDatasource } from "@table-craft/desktop/renderer/actions/datasourceCommands.js";
import { bridge } from "@table-craft/desktop/renderer/bridge.js";
import {
  Button,
  CONTENT_CLASS,
  FieldRow,
  INPUT_CLASS,
  OVERLAY_CLASS,
  TextInput,
} from "@table-craft/desktop/renderer/dialogs/parts.js";
import {
  draftFromView,
  draftProblems,
  duplicateDraft,
  newDraft,
  secretPlaceholder,
  toSaveRequest,
  type FormDraft,
} from "@table-craft/desktop/renderer/model/datasourceForm.js";
import { folderPaths } from "@table-craft/desktop/renderer/model/datasourceTree.js";
import { useDataSourcesDialog, type DialogTarget } from "@table-craft/desktop/renderer/state/dataSourcesDialog.js";
import { pluginOf, useDatasources } from "@table-craft/desktop/renderer/state/datasources.js";
import { cn } from "@table-craft/desktop/renderer/ui/cn.js";
import { ACTION_ICONS, DatabaseIcon, ReadOnlyIcon } from "@table-craft/desktop/renderer/ui/icons.js";
import { TINT_SWATCH } from "@table-craft/desktop/renderer/ui/tint.js";

const SECRET_MODE_LABEL: Readonly<Record<SecretMode, string>> = {
  forever: "Forever",
  untilRestart: "Until restart",
  never: "Never",
};
const NEW_KEY_PREFIX = "new-";
const READ_ONLY_HINT = "A guard against accidents, not a security boundary: use a read-only database user for that.";

type TestState = { readonly kind: "testing" } | { readonly kind: "done"; readonly result: ProbeResult };

/** "Succeeded · PostgreSQL 17.4 · 38 ms" (plan 004). */
export function testSummary(result: Extract<ProbeResult, { ok: true }>): string {
  const server = result.serverVersion === null ? result.pluginName : `${result.pluginName} ${result.serverVersion}`;
  return `Succeeded · ${server} · ${String(Math.round(result.elapsedMs))} ms`;
}

interface EditorState {
  /** Drafts the user touched, by key; untouched datasources are read from the store. */
  readonly edits: Readonly<Record<string, FormDraft>>;
  /** Keys of drafts not saved yet, in the order they were added. */
  readonly added: readonly string[];
  readonly selected: string | null;
  readonly choosingPlugin: boolean;
}

let draftsCreated = 0;
function nextKey(): string {
  return `${NEW_KEY_PREFIX}${String(draftsCreated++)}`;
}

function initialState(
  target: DialogTarget,
  datasources: readonly DatasourceView[],
  plugins: readonly PluginInfo[],
  defaultMode: SecretMode,
): EditorState {
  const names = datasources.map((datasource) => datasource.name);
  if (target.kind === "edit") {
    const selected = target.id ?? datasources[0]?.id ?? null;
    return { edits: {}, added: [], selected, choosingPlugin: selected === null };
  }
  if (target.kind === "duplicate") {
    const source = datasources.find((datasource) => datasource.id === target.id);
    if (source === undefined) return { edits: {}, added: [], selected: null, choosingPlugin: true };
    const draft = duplicateDraft(nextKey(), source, pluginOf(plugins, source.pluginId), names, defaultMode);
    return { edits: { [draft.key]: draft }, added: [draft.key], selected: draft.key, choosingPlugin: false };
  }
  const plugin = target.pluginId === null ? undefined : pluginOf(plugins, target.pluginId);
  if (plugin === undefined) return { edits: {}, added: [], selected: null, choosingPlugin: true };
  const draft = newDraft(nextKey(), plugin, names, defaultMode, target.folder);
  return { edits: { [draft.key]: draft }, added: [draft.key], selected: draft.key, choosingPlugin: false };
}

function PluginPicker({ plugins, onPick }: { plugins: readonly PluginInfo[]; onPick: (plugin: PluginInfo) => void }) {
  return (
    <div className="flex flex-col gap-gap p-gap">
      <h3 className="font-semibold">New data source</h3>
      <p className="text-ink-muted">Choose the kind of database.</p>
      <ul aria-label="Database kinds" className="flex flex-col gap-1">
        {plugins.map((plugin) => (
          <li key={plugin.id}>
            <button
              type="button"
              disabled={plugin.unavailableReason !== null}
              title={plugin.unavailableReason ?? undefined}
              className="flex h-row w-full items-center gap-cell rounded px-gap text-left hover:bg-raised disabled:opacity-50"
              onClick={() => onPick(plugin)}
            >
              <DatabaseIcon aria-hidden className="size-icon text-accent" />
              {plugin.name}
              {plugin.unavailableReason === null ? null : (
                <span className="truncate text-ink-muted">{plugin.unavailableReason}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface FieldProps {
  readonly field: ConnectionField;
  readonly draft: FormDraft;
  readonly encryption: { readonly available: boolean; readonly reason: string | null };
  readonly onChange: (change: Partial<FormDraft>) => void;
}

function SecretField({ field, draft, encryption, onChange }: FieldProps) {
  const id = useId();
  const change = draft.secrets[field.key] ?? { action: "keep" };
  const mode = draft.secretModes[field.key] ?? "never";
  const stored = draft.storedSecrets.includes(field.key);
  return (
    <FieldRow label={field.label} htmlFor={id}>
      <TextInput
        id={id}
        type="password"
        className="flex-1"
        placeholder={secretPlaceholder(draft, field.key)}
        value={change.action === "set" ? change.value : ""}
        onChange={(event) =>
          onChange({
            secrets: {
              ...draft.secrets,
              [field.key]:
                event.target.value === "" ? { action: "keep" } : { action: "set", value: event.target.value },
            },
          })
        }
      />
      <select
        aria-label={`Save ${field.label.toLowerCase()}`}
        className={INPUT_CLASS}
        value={mode}
        title={encryption.available ? undefined : (encryption.reason ?? undefined)}
        onChange={(event) =>
          onChange({ secretModes: { ...draft.secretModes, [field.key]: event.target.value as SecretMode } })
        }
      >
        {SECRET_MODES.map((option) => (
          <option key={option} value={option} disabled={option === "forever" && !encryption.available}>
            {SECRET_MODE_LABEL[option]}
          </option>
        ))}
      </select>
      {stored || change.action === "clear" ? (
        <Button
          disabled={change.action === "clear"}
          onClick={() => onChange({ secrets: { ...draft.secrets, [field.key]: { action: "clear" } } })}
        >
          Clear
        </Button>
      ) : null}
    </FieldRow>
  );
}

function PlainField({ field, draft, onChange }: FieldProps) {
  const id = useId();
  const value = draft.values[field.key];
  const set = (next: string | boolean) => onChange({ values: { ...draft.values, [field.key]: next } });
  if (field.kind === "checkbox") {
    return (
      <FieldRow label={field.label} htmlFor={id}>
        <input id={id} type="checkbox" checked={value === true} onChange={(event) => set(event.target.checked)} />
      </FieldRow>
    );
  }
  const text = typeof value === "string" ? value : "";
  if (field.kind === "select") {
    return (
      <FieldRow label={field.label} htmlFor={id}>
        <select id={id} className={INPUT_CLASS} value={text} onChange={(event) => set(event.target.value)}>
          {field.required === true ? null : <option value="">—</option>}
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </FieldRow>
    );
  }
  return (
    <FieldRow label={field.label} htmlFor={id}>
      <TextInput
        id={id}
        className={field.kind === "number" ? "w-24" : "flex-1"}
        inputMode={field.kind === "number" ? "numeric" : undefined}
        placeholder={field.placeholder}
        value={text}
        onChange={(event) => set(event.target.value)}
      />
      {field.kind === "file" ? (
        <Button
          onClick={() => {
            void bridge()
              .chooseFile(field.label)
              .then((chosen) => {
                if (chosen.ok && chosen.value !== null) set(chosen.value);
              });
          }}
        >
          Browse…
        </Button>
      ) : null}
    </FieldRow>
  );
}

function Fields(props: Omit<FieldProps, "field"> & { readonly fields: readonly ConnectionField[] }) {
  const { fields, ...rest } = props;
  return fields.map((field) =>
    field.secret === true ? (
      <SecretField key={field.key} field={field} {...rest} />
    ) : (
      <PlainField key={field.key} field={field} {...rest} />
    ),
  );
}

function SectionTitle({ children }: { readonly children: string }) {
  return <h3 className="col-span-2 mt-gap border-b border-line pb-1 font-semibold text-ink-muted">{children}</h3>;
}

interface FormProps {
  readonly draft: FormDraft;
  readonly plugin: PluginInfo | undefined;
  readonly folders: readonly string[];
  readonly onChange: (change: Partial<FormDraft>) => void;
}

function DraftForm({ draft, plugin, folders, onChange }: FormProps) {
  const encryption = useDatasources((state) => state.encryption);
  const nameId = useId();
  const folderId = useId();
  const commentId = useId();
  const foldersId = useId();
  const fields = plugin?.fields ?? [];
  const general = fields.filter((field) => field.group !== "advanced");
  const advanced = fields.filter((field) => field.group === "advanced");
  const fieldProps = { draft, encryption, onChange };
  return (
    <fieldset
      disabled={draft.ephemeral}
      className="grid min-h-0 grid-cols-[8rem_1fr] content-start items-center gap-x-gap gap-y-1 overflow-y-auto p-gap"
    >
      {draft.ephemeral ? (
        <p className="col-span-2 mb-gap text-ink-muted">
          From TABLE_CRAFT_DATASOURCE: not saved, and not editable here. Duplicate it to keep a copy.
        </p>
      ) : null}
      <FieldRow label="Name" htmlFor={nameId}>
        <TextInput
          id={nameId}
          className="flex-1"
          value={draft.name}
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </FieldRow>
      <FieldRow label="Folder" htmlFor={folderId}>
        <TextInput
          id={folderId}
          className="flex-1"
          list={foldersId}
          placeholder="Docker/Main"
          value={draft.folder}
          onChange={(event) => onChange({ folder: event.target.value })}
        />
        <datalist id={foldersId}>
          {folders.map((folder) => (
            <option key={folder} value={folder} />
          ))}
        </datalist>
      </FieldRow>
      <FieldRow label="Comment" htmlFor={commentId}>
        <TextInput
          id={commentId}
          className="flex-1"
          value={draft.comment}
          onChange={(event) => onChange({ comment: event.target.value })}
        />
      </FieldRow>
      <SectionTitle>General</SectionTitle>
      <Fields fields={general} {...fieldProps} />
      {draft.ephemeral || encryption.available ? null : (
        <p className="col-span-2 text-ink-muted">Forever is unavailable: {encryption.reason}</p>
      )}
      {advanced.length === 0 ? null : (
        <>
          <SectionTitle>Advanced</SectionTitle>
          <Fields fields={advanced} {...fieldProps} />
        </>
      )}
      <SectionTitle>Options</SectionTitle>
      <FieldRow label="Read-only">
        <label className="flex items-center gap-cell" title={READ_ONLY_HINT}>
          <input
            type="checkbox"
            checked={draft.readOnly}
            onChange={(event) => onChange({ readOnly: event.target.checked })}
          />
          <ReadOnlyIcon aria-hidden className="size-icon text-ink-muted" />
          <span className="text-ink-muted">Refuse writes in this data source's sessions</span>
        </label>
      </FieldRow>
      <FieldRow label="Colour">
        <div role="radiogroup" aria-label="Colour" className="flex items-center gap-1">
          <button
            type="button"
            role="radio"
            aria-checked={draft.color === null}
            aria-label="No colour"
            className={cn(
              "size-row rounded border border-line text-ink-muted",
              draft.color === null && "outline-2 outline-accent",
            )}
            onClick={() => onChange({ color: null })}
          >
            –
          </button>
          {DATASOURCE_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={draft.color === color}
              aria-label={color}
              className={cn("size-row rounded", TINT_SWATCH[color], draft.color === color && "outline-2 outline-ink")}
              onClick={() => onChange({ color })}
            />
          ))}
        </div>
      </FieldRow>
    </fieldset>
  );
}

function Editor({ target }: { readonly target: DialogTarget }) {
  const datasources = useDatasources((state) => state.datasources);
  const plugins = useDatasources((state) => state.plugins);
  const emptyFolders = useDatasources((state) => state.emptyFolders);
  const encryption = useDatasources((state) => state.encryption);
  const defaultMode: SecretMode = encryption.available ? "forever" : "untilRestart";
  const hide = useDataSourcesDialog((state) => state.hide);
  const [state, setState] = useState<EditorState>(() => initialState(target, datasources, plugins, defaultMode));
  const [tests, setTests] = useState<Readonly<Record<string, TestState>>>({});
  const [failure, setFailure] = useState<BridgeFailure | null>(null);
  const [saving, setSaving] = useState(false);
  const folders = useMemo(() => folderPaths(datasources, emptyFolders), [datasources, emptyFolders]);

  function draftOf(key: string): FormDraft | undefined {
    const edited = state.edits[key];
    if (edited !== undefined) return edited;
    const view = datasources.find((datasource) => datasource.id === key);
    return view === undefined ? undefined : draftFromView(view, pluginOf(plugins, view.pluginId));
  }

  const listed: readonly FormDraft[] = [
    ...datasources.flatMap((view) => draftOf(view.id) ?? []),
    ...state.added.flatMap((key) => state.edits[key] ?? []),
  ];
  const current = state.choosingPlugin || state.selected === null ? undefined : draftOf(state.selected);
  const plugin = current === undefined ? undefined : pluginOf(plugins, current.pluginId);
  const test = current === undefined ? undefined : tests[current.key];

  function change(key: string, patch: Partial<FormDraft>): void {
    const draft = draftOf(key);
    if (draft === undefined) return;
    setState((previous) => ({ ...previous, edits: { ...previous.edits, [key]: { ...draft, ...patch, dirty: true } } }));
    setFailure(null);
  }

  function select(key: string): void {
    setState((previous) => ({ ...previous, selected: key, choosingPlugin: false }));
    setFailure(null);
  }

  function addDraft(draft: FormDraft): void {
    setState((previous) => ({
      edits: { ...previous.edits, [draft.key]: draft },
      added: [...previous.added, draft.key],
      selected: draft.key,
      choosingPlugin: false,
    }));
  }

  const names = listed.map((draft) => draft.name);

  /** Saves one draft; false, with the failure shown, when it could not. */
  async function save(draft: FormDraft): Promise<boolean> {
    const draftPlugin = pluginOf(plugins, draft.pluginId);
    const problem = draftProblems(draft, draftPlugin)[0];
    if (problem !== undefined) {
      select(draft.key);
      setFailure({ message: problem, hint: `Fix it in ${draft.name || "the form"}, then save again.` });
      return false;
    }
    const answer = await bridge().saveDatasource(toSaveRequest(draft, draftPlugin));
    if (!answer.ok) {
      select(draft.key);
      setFailure(answer.error);
      return false;
    }
    const savedId = answer.value.id;
    setState((previous) => {
      const { [draft.key]: _saved, ...edits } = previous.edits;
      return {
        ...previous,
        edits,
        added: previous.added.filter((key) => key !== draft.key),
        selected: previous.selected === draft.key ? savedId : previous.selected,
      };
    });
    return true;
  }

  async function saveAll(close: boolean): Promise<void> {
    setSaving(true);
    try {
      const dirty = close ? listed.filter((draft) => draft.dirty && !draft.ephemeral) : current?.dirty ? [current] : [];
      for (const draft of dirty) if (!(await save(draft))) return;
      if (close) hide();
    } finally {
      setSaving(false);
    }
  }

  async function runTest(draft: FormDraft): Promise<void> {
    setTests((previous) => ({ ...previous, [draft.key]: { kind: "testing" } }));
    const answer = await bridge().testDatasource(toSaveRequest(draft, pluginOf(plugins, draft.pluginId)));
    const result: ProbeResult = answer.ok
      ? answer.value
      : { ok: false, error: { code: "connectionFailed", ...answer.error } };
    setTests((previous) => ({ ...previous, [draft.key]: { kind: "done", result } }));
  }

  async function remove(draft: FormDraft): Promise<void> {
    if (draft.id === undefined) {
      setState((previous) => {
        const { [draft.key]: _removed, ...edits } = previous.edits;
        return { ...previous, edits, added: previous.added.filter((key) => key !== draft.key), selected: null };
      });
      return;
    }
    const view = datasources.find((datasource) => datasource.id === draft.id);
    if (view !== undefined) await deleteDatasource(view);
  }

  const AddIcon = ACTION_ICONS.add;
  const DuplicateIcon = ACTION_ICONS.duplicate;
  const DeleteIcon = ACTION_ICONS.delete;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Dialog.Title className="shrink-0 border-b border-line px-gap py-cell font-semibold">Data Sources</Dialog.Title>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-dialog-list shrink-0 flex-col border-r border-line">
          <div role="toolbar" aria-label="Data source list" className="flex gap-1 p-1">
            <button
              type="button"
              aria-label="Add data source"
              title="Add data source"
              className="flex size-tab items-center justify-center rounded hover:bg-raised"
              onClick={() => setState((previous) => ({ ...previous, choosingPlugin: true }))}
            >
              <AddIcon aria-hidden className="size-icon" />
            </button>
            <button
              type="button"
              aria-label="Duplicate data source"
              title="Duplicate data source"
              disabled={current === undefined}
              className="flex size-tab items-center justify-center rounded hover:bg-raised disabled:opacity-40"
              onClick={() => {
                const view = datasources.find((datasource) => datasource.id === current?.id);
                if (view !== undefined) {
                  addDraft(duplicateDraft(nextKey(), view, pluginOf(plugins, view.pluginId), names, defaultMode));
                }
              }}
            >
              <DuplicateIcon aria-hidden className="size-icon" />
            </button>
            <button
              type="button"
              aria-label="Remove data source"
              title="Remove data source"
              disabled={current === undefined || current.ephemeral}
              className="flex size-tab items-center justify-center rounded hover:bg-raised disabled:opacity-40"
              onClick={() => {
                if (current !== undefined) void remove(current);
              }}
            >
              <DeleteIcon aria-hidden className="size-icon" />
            </button>
          </div>
          <ul role="listbox" aria-label="Data sources" className="min-h-0 flex-1 overflow-y-auto p-1">
            {listed.map((draft) => (
              <li
                key={draft.key}
                role="option"
                aria-selected={draft.key === current?.key}
                className={cn(
                  "flex h-row cursor-default items-center gap-cell rounded px-cell hover:bg-raised",
                  draft.key === current?.key && "bg-selection hover:bg-selection",
                )}
                onClick={() => select(draft.key)}
              >
                <DatabaseIcon aria-hidden className="size-icon shrink-0 text-accent" />
                <span className={cn("truncate", draft.id === undefined && "italic")}>
                  {draft.name || "Unnamed"}
                  {draft.dirty ? " *" : ""}
                </span>
                {draft.color === null ? null : (
                  <span aria-hidden className={cn("size-2.5 shrink-0 rounded-sm", TINT_SWATCH[draft.color])} />
                )}
                {draft.folder === "" ? null : <span className="ml-auto truncate text-ink-muted">{draft.folder}</span>}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          {current === undefined ? (
            <PluginPicker
              plugins={plugins}
              onPick={(picked) => {
                const folder = target.kind === "new" ? target.folder : "";
                addDraft(newDraft(nextKey(), picked, names, defaultMode, folder));
              }}
            />
          ) : (
            <>
              <div className="flex shrink-0 items-center gap-cell border-b border-line px-gap py-1 text-ink-muted">
                <DatabaseIcon aria-hidden className="size-icon text-accent" />
                {plugin?.name ?? current.pluginId}
                {plugin?.unavailableReason == null ? null : (
                  <span className="text-danger">{plugin.unavailableReason}</span>
                )}
              </div>
              <DraftForm
                key={current.key}
                draft={current}
                plugin={plugin}
                folders={folders}
                onChange={(patch) => change(current.key, patch)}
              />
            </>
          )}
        </div>
      </div>
      {failure === null ? null : (
        <p role="alert" className="shrink-0 border-t border-line px-gap py-1 text-danger">
          {failure.message} <span className="text-ink-muted">{failure.hint}</span>
        </p>
      )}
      <div className="flex shrink-0 items-center gap-gap border-t border-line p-gap">
        <Button
          disabled={current === undefined || current.ephemeral || test?.kind === "testing"}
          onClick={() => {
            if (current !== undefined) void runTest(current);
          }}
        >
          Test Connection
        </Button>
        <TestResult state={test} />
        <span className="flex-1" />
        <Button variant="primary" disabled={saving} onClick={() => void saveAll(true)}>
          OK
        </Button>
        <Button onClick={hide}>Cancel</Button>
        <Button disabled={saving || current?.dirty !== true || current.ephemeral} onClick={() => void saveAll(false)}>
          Apply
        </Button>
      </div>
    </div>
  );
}

function TestResult({ state }: { readonly state: TestState | undefined }) {
  if (state === undefined) return null;
  if (state.kind === "testing") return <span className="text-ink-muted">Testing…</span>;
  const { result } = state;
  if (result.ok) {
    return (
      <span data-testid="test-result" data-ok="true" className="truncate text-success">
        {testSummary(result)}
      </span>
    );
  }
  return (
    <span
      data-testid="test-result"
      data-ok="false"
      className="line-clamp-2 min-w-0 text-danger"
      title={`${result.error.message} ${result.error.hint}`}
    >
      {result.error.message} <span className="text-ink-muted">{result.error.hint}</span>
    </span>
  );
}

/** DataGrip's Data Sources and Drivers dialog: the list on the left, the selected one's form on the right. */
export function DataSourcesDialog() {
  const target = useDataSourcesDialog((state) => state.target);
  return (
    <Dialog.Root
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) useDataSourcesDialog.getState().hide();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY_CLASS} />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            CONTENT_CLASS,
            "flex h-dialog-height max-h-[95vh] w-dialog max-w-[95vw] flex-col overflow-hidden",
          )}
        >
          {target === null ? null : <Editor key={JSON.stringify(target)} target={target} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
