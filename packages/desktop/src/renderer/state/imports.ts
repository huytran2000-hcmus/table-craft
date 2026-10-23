import { create } from "zustand";
import type {
  EngineError,
  ImportErrorPolicy,
  ImportEvent,
  ImportFormat,
  ImportTarget,
  ImportTask,
  ImportTransaction,
} from "@table-craft/desktop/engine/protocol.js";
import type { EngineClient } from "@table-craft/desktop/renderer/engine/client.js";
import { useCatalog } from "@table-craft/desktop/renderer/state/catalog.js";
import { useDatasources } from "@table-craft/desktop/renderer/state/datasources.js";
import { useSettings } from "@table-craft/desktop/renderer/state/settings.js";

/** One background import as Services lists it (decision 046), never saved. */
export interface ImportEntry {
  readonly datasourceId: string;
  /** The target's namespace, read again when the task ends; null for a task found by `import.list`. */
  readonly path: readonly string[] | null;
  readonly task: ImportTask;
}

export interface ImportRequest {
  readonly file: string;
  readonly format: ImportFormat;
  readonly target: ImportTarget;
  readonly transaction: ImportTransaction;
  readonly errors: ImportErrorPolicy;
}

export interface ImportsState {
  /** Oldest first. */
  readonly entries: readonly ImportEntry[];
  /** Rejects when the engine refuses the request; a task that fails later reports through events. */
  readonly start: (datasourceId: string, request: ImportRequest) => Promise<ImportTask>;
  readonly received: (datasourceId: string, event: ImportEvent) => void;
  /** The datasource's engine went away, and with it the import's connection: the server rolls back what was open. */
  readonly detached: (datasourceId: string, error: EngineError | null) => void;
  readonly cancel: (taskId: string) => Promise<void>;
  /** Runs a finished import again from its `resumeFrom` row: Resume after a partial commit, Retry otherwise. */
  readonly resume: (taskId: string) => Promise<ImportTask | null>;
  /** Drops a finished task from the list; a running one stays. */
  readonly dismiss: (taskId: string) => void;
  /** Resolves with the task once it is done, failed or cancelled. */
  readonly finished: (taskId: string) => Promise<ImportTask>;
}

export interface ImportsDependencies {
  readonly client: (datasourceId: string) => Promise<EngineClient>;
  /** `data.exportStallSeconds`, read when a task starts. */
  readonly stallSeconds: () => number;
  /** Reads the target's namespace again once a task ends, so a new table shows (plan 021, ruling 17). */
  readonly refresh: (datasourceId: string, path: readonly string[]) => void;
}

const TRAILING_PERIOD = /\.$/;
const ROLLED_BACK = "The server rolls back what was not committed when the connection goes.";
const AGAIN_HINT = "Connect again, then check the table before importing again.";

export function isImporting(entry: ImportEntry): boolean {
  return entry.task.state === "running";
}

/** The task's action after it ended: Resume when rows were committed, Retry when none were, nothing while it runs. */
export function resumeLabel(task: ImportTask): "Resume" | "Retry" | null {
  if (task.state === "running" || task.state === "done") return null;
  return task.resumeFrom > 1 ? "Resume" : "Retry";
}

export function createImportsStore(dependencies: ImportsDependencies) {
  const waiting = new Map<string, ((task: ImportTask) => void)[]>();

  return create<ImportsState>()((set, get) => {
    function entryOf(taskId: string): ImportEntry | undefined {
      return get().entries.find((entry) => entry.task.taskId === taskId);
    }

    /** Events can overtake the answer that started a task, so whichever comes first adds it. */
    function upsert(datasourceId: string, task: ImportTask, path: readonly string[] | null = null): void {
      const current = entryOf(task.taskId);
      // A late progress event must not undo a final state.
      if (current !== undefined && current.task.state !== "running" && task.state === "running") return;
      const entry = { datasourceId, path: path ?? current?.path ?? null, task };
      const entries =
        current === undefined
          ? [...get().entries, entry]
          : get().entries.map((existing) => (existing.task.taskId === task.taskId ? entry : existing));
      set({ entries });
      if (task.state === "running") return;
      if (current?.task.state === "running" && entry.path !== null) dependencies.refresh(datasourceId, entry.path);
      const resolvers = waiting.get(task.taskId) ?? [];
      waiting.delete(task.taskId);
      for (const resolve of resolvers) resolve(task);
    }

    async function begin(
      datasourceId: string,
      path: readonly string[] | null,
      call: (client: EngineClient) => Promise<ImportTask>,
    ): Promise<ImportTask> {
      const task = await call(await dependencies.client(datasourceId));
      const seen = entryOf(task.taskId);
      // The final event may have come first; keep it, but remember where the table is.
      upsert(datasourceId, seen === undefined ? task : seen.task, path);
      if (seen !== undefined && seen.task.state !== "running" && path !== null)
        dependencies.refresh(datasourceId, path);
      return task;
    }

    return {
      entries: [],
      start: (datasourceId, request) =>
        begin(datasourceId, request.target.path, (client) =>
          client.call("import.start", { ...request, stallSeconds: dependencies.stallSeconds() }),
        ),
      received(datasourceId, event) {
        upsert(datasourceId, event.task);
      },
      detached(datasourceId, error) {
        for (const entry of get().entries) {
          if (entry.datasourceId !== datasourceId || !isImporting(entry)) continue;
          const { task } = entry;
          const kept =
            task.transaction.mode === "all"
              ? "Nothing was imported."
              : `${task.committed.toLocaleString("en-US")} rows were committed when it stopped.`;
          const why = error === null ? "Disconnected while importing" : error.message.replace(TRAILING_PERIOD, "");
          upsert(datasourceId, {
            ...task,
            state: error === null ? "cancelled" : "failed",
            error: {
              code: error === null ? "cancelled" : "importFailed",
              reason: error === null ? "cancelled" : "target",
              message: `${why}. ${ROLLED_BACK} ${kept}`,
              hint: error === null ? AGAIN_HINT : error.hint,
            },
          });
        }
      },
      async cancel(taskId) {
        const entry = entryOf(taskId);
        if (entry === undefined || !isImporting(entry)) return;
        const client = await dependencies.client(entry.datasourceId);
        await client.call("import.cancel", { taskId });
      },
      async resume(taskId) {
        const entry = entryOf(taskId);
        if (entry === undefined || resumeLabel(entry.task) === null) return null;
        const task = await begin(entry.datasourceId, entry.path, (client) =>
          client.call("import.resume", { taskId, stallSeconds: dependencies.stallSeconds() }),
        );
        // The run that continues it takes its place, so its Resume cannot be chosen twice.
        set({ entries: get().entries.filter((existing) => existing.task.taskId !== taskId) });
        return task;
      },
      dismiss(taskId) {
        const entry = entryOf(taskId);
        if (entry === undefined || isImporting(entry)) return;
        set({ entries: get().entries.filter((existing) => existing !== entry) });
      },
      finished(taskId) {
        const entry = entryOf(taskId);
        if (entry !== undefined && !isImporting(entry)) return Promise.resolve(entry.task);
        return new Promise((resolve) => {
          waiting.set(taskId, [...(waiting.get(taskId) ?? []), resolve]);
        });
      },
    };
  });
}

export type ImportsStore = ReturnType<typeof createImportsStore>;

export const useImports = createImportsStore({
  client: (datasourceId) => useDatasources.getState().connect(datasourceId),
  stallSeconds: () => useSettings.getState().settings.data.exportStallSeconds,
  refresh: (datasourceId, path) => void useCatalog.getState().synchronize(datasourceId, path),
});
