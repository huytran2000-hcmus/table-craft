import type { ActionContext } from "@table-craft/desktop/renderer/actions/context.js";
import { defineAction, type AnyAction } from "@table-craft/desktop/renderer/actions/registry.js";
import { selectedRelation } from "@table-craft/desktop/renderer/actions/tableActions.js";
import { bridge } from "@table-craft/desktop/renderer/bridge.js";
import { pathKey } from "@table-craft/desktop/renderer/model/explorerTree.js";
import { useCatalog } from "@table-craft/desktop/renderer/state/catalog.js";
import { capabilitiesOf, datasourceById, useDatasources } from "@table-craft/desktop/renderer/state/datasources.js";
import { isImporting, resumeLabel, useImports, type ImportEntry } from "@table-craft/desktop/renderer/state/imports.js";
import { parseImportAnswer, useModal } from "@table-craft/desktop/renderer/state/modal.js";
import { toError } from "@table-craft/desktop/renderer/state/resultWindows.js";

export const IMPORT_ACTION_IDS = {
  importIntoTable: "explorer.importIntoTable",
  importNewTable: "explorer.importNewTable",
  cancel: "import.cancel",
  resume: "import.resume",
  revealRejected: "import.revealRejected",
  dismiss: "import.dismiss",
} as const;

const OPEN_TITLE = "Import Data";
const BULK_INSERT = "bulkInsert";

/** Where an import can write: a datasource that is writable and whose plugin declares `bulkInsert`. */
function importable(datasourceId: string): { readonly highlight: string | undefined } | null {
  const state = useDatasources.getState();
  const view = datasourceById(state, datasourceId);
  if (view === undefined || view.readOnly) return null;
  if (!capabilitiesOf(state.plugins, view.pluginId).includes(BULK_INSERT)) return null;
  return { highlight: state.plugins.find((plugin) => plugin.id === view.pluginId)?.highlight ?? undefined };
}

/** The selected table, its columns as the catalog knows them. */
function tableToImport(context: ActionContext) {
  const target = selectedRelation(context);
  if (target === null) return null;
  const allowed = importable(target.datasourceId);
  if (allowed === null) return null;
  const described =
    useCatalog.getState().catalogs[target.datasourceId]?.namespaceStates[pathKey(target.path)]?.described;
  const relation = described?.catalog.relations.find((candidate) => candidate.name === target.relation);
  if (relation?.kind !== "table" || relation.columns.length === 0) return null;
  return { ...target, ...allowed, columns: relation.columns.map((column) => column.name) };
}

/** The selected schema (or a group in it) a new table can go in. */
function schemaToImport(context: ActionContext) {
  const { selection } = context;
  if (selection?.kind !== "catalog" || selection.name !== null) return null;
  const allowed = importable(selection.id);
  if (allowed === null) return null;
  const namespaces = useCatalog.getState().catalogs[selection.id]?.namespaces ?? [];
  const key = pathKey(selection.path);
  const namespace = namespaces.find((candidate) => pathKey(candidate.path) === key);
  if (namespace?.kind !== "schema") return null;
  return { datasourceId: selection.id, path: selection.path, ...allowed };
}

async function reportImportFailure(cause: unknown): Promise<void> {
  const error = toError(cause);
  await useModal
    .getState()
    .ask({ kind: "notice", title: "Could not import", message: error.message, hint: error.hint });
}

/**
 * The completion notice: a failed import says what is kept and what to do, since its Services
 * line may be scrolled away; a finished or cancelled one shows only there and in the status bar.
 */
function noticeWhenFailed(taskId: string): void {
  void useImports
    .getState()
    .finished(taskId)
    .then(async (task) => {
      if (task.state !== "failed" || task.error === null) return;
      await useModal
        .getState()
        .ask({ kind: "notice", title: "Import failed", message: task.error.message, hint: task.error.hint });
    });
}

async function browse(): Promise<string | null> {
  const chosen = await bridge().openFile(OPEN_TITLE);
  return chosen.ok ? chosen.value : null;
}

async function askAndStart(target: {
  readonly datasourceId: string;
  readonly path: readonly string[];
  readonly relation: string;
  readonly columns: readonly string[] | null;
  readonly highlight: string | undefined;
}): Promise<void> {
  const client = () => useDatasources.getState().connect(target.datasourceId);
  const where = target.path.join(".");
  const answer = await useModal.getState().ask({
    kind: "import",
    title: "Import Data",
    note:
      target.columns === null
        ? `Into a new table in ${where}, created before the first row is written.`
        : `Into ${where}.${target.relation}, on a connection of its own.`,
    columns: target.columns,
    relation: target.relation,
    highlight: target.highlight,
    browse,
    preview: async (file, format) => (await client()).call("import.preview", { file, format }),
    ddl: async (relation, columns) => (await client()).call("import.ddl", { path: target.path, relation, columns }),
  });
  if (answer === null) return;
  const choice = parseImportAnswer(answer);
  const request = {
    file: choice.file,
    format: choice.format,
    transaction: choice.transaction,
    errors: choice.errors,
  };
  try {
    const task = await useImports.getState().start(target.datasourceId, {
      ...request,
      target:
        choice.columns === null
          ? { kind: "table", path: target.path, relation: target.relation, mapping: choice.mapping ?? [] }
          : { kind: "new", path: target.path, relation: choice.relation, columns: choice.columns },
    });
    noticeWhenFailed(task.taskId);
  } catch (cause) {
    await reportImportFailure(cause);
  }
}

/** A Services line names its task; from the palette the newest one the action fits. */
export interface ImportTaskArgs {
  readonly taskId: string;
}

function entryFor(
  args: Partial<ImportTaskArgs> | undefined,
  fits: (entry: ImportEntry) => boolean,
): ImportEntry | null {
  const { entries } = useImports.getState();
  if (args?.taskId !== undefined) {
    const entry = entries.find((candidate) => candidate.task.taskId === args.taskId);
    return entry !== undefined && fits(entry) ? entry : null;
  }
  return [...entries].reverse().find(fits) ?? null;
}

const resumable = (entry: ImportEntry) => resumeLabel(entry.task) !== null;
const rejectedKept = (entry: ImportEntry) => !isImporting(entry) && entry.task.rejectedFile !== null;
const dismissable = (entry: ImportEntry) => !isImporting(entry);

export const IMPORT_ACTIONS: readonly AnyAction[] = [
  defineAction({
    id: IMPORT_ACTION_IDS.importIntoTable,
    title: "Import Data from File…",
    category: "Database",
    icon: "import",
    when: (context) => tableToImport(context) !== null,
    run: async (context) => {
      const target = tableToImport(context);
      if (target !== null) await askAndStart(target);
    },
  }),
  defineAction({
    id: IMPORT_ACTION_IDS.importNewTable,
    title: "Import Data into New Table…",
    category: "Database",
    icon: "import",
    when: (context) => schemaToImport(context) !== null,
    run: async (context) => {
      const target = schemaToImport(context);
      if (target !== null) await askAndStart({ ...target, relation: "", columns: null });
    },
  }),
  defineAction<Partial<ImportTaskArgs> | undefined>({
    id: IMPORT_ACTION_IDS.cancel,
    title: "Cancel Import",
    category: "Tool Windows",
    icon: "cancel",
    when: () => entryFor(undefined, isImporting) !== null,
    run: async (_context, args) => {
      const entry = entryFor(args, isImporting);
      if (entry !== null) await useImports.getState().cancel(entry.task.taskId);
    },
  }),
  defineAction<Partial<ImportTaskArgs> | undefined>({
    id: IMPORT_ACTION_IDS.resume,
    title: "Resume or Retry Import",
    category: "Tool Windows",
    icon: "rerun",
    when: () => entryFor(undefined, resumable) !== null,
    run: async (_context, args) => {
      const entry = entryFor(args, resumable);
      if (entry === null) return;
      try {
        const task = await useImports.getState().resume(entry.task.taskId);
        if (task !== null) noticeWhenFailed(task.taskId);
      } catch (cause) {
        await reportImportFailure(cause);
      }
    },
  }),
  defineAction<Partial<ImportTaskArgs> | undefined>({
    id: IMPORT_ACTION_IDS.revealRejected,
    title: "Reveal Rejected Rows",
    category: "Tool Windows",
    icon: "folder",
    when: () => entryFor(undefined, rejectedKept) !== null,
    run: async (_context, args) => {
      const file = entryFor(args, rejectedKept)?.task.rejectedFile ?? null;
      if (file === null) return;
      const revealed = await bridge().revealFile(file);
      if (!revealed.ok) {
        await useModal.getState().ask({ kind: "notice", title: "Could not reveal the file", ...revealed.error });
      }
    },
  }),
  defineAction<Partial<ImportTaskArgs> | undefined>({
    id: IMPORT_ACTION_IDS.dismiss,
    title: "Remove Finished Import",
    category: "Tool Windows",
    icon: "close",
    when: () => entryFor(undefined, dismissable) !== null,
    run: (_context, args) => {
      const entry = entryFor(args, dismissable);
      if (entry !== null) useImports.getState().dismiss(entry.task.taskId);
    },
  }),
];
