import { randomBytes } from "node:crypto";
import {
  fileChunks,
  ImportError,
  openRejectedFile,
  rejectedPathOf,
  runImport,
  systemClock,
  type ExportClock,
  type ImportFormat,
  type ImportWriter,
  type RejectedFile,
} from "@table-craft/core";
import type { Logger } from "@table-craft/desktop/log/record.js";
import type {
  EngineErrorCode,
  ImportErrorPolicy,
  ImportEvent,
  ImportEventType,
  ImportFailureReason,
  ImportTask,
  ImportTransaction,
} from "@table-craft/desktop/engine/protocol.js";

/** How long a finished import waits for its session to close before it reports anyway. */
const SESSION_CLOSE_GRACE_MS = 5_000;
const TASK_PREFIX = "import-";
const TASK_ID_RANDOM_BYTES = 4;
const UNEXPECTED_HINT = "This is a TableCraft bug; restart the app and report it.";
const CONNECT_HINT = "Check the connection, then choose Retry.";
const CANCEL_HINT = "Import again when you are ready.";

/** Rejects once `signal` aborts; never settles otherwise. */
function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const fail = (): void => reject(new Error("cancelled"));
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
  });
}

/** The import's own session, in manual mode, and how to let go of it; `close` settles in bounded time. */
export interface ImportSession {
  readonly writer: ImportWriter;
  close(): Promise<void>;
}

/** Everything a task needs to run, and to run again on Resume. */
export interface ImportJob {
  readonly file: string;
  readonly size: number;
  readonly format: ImportFormat;
  /** The qualified name, for the task; the session already knows where it writes. */
  readonly table: string;
  /** This import created the table before its first run. */
  readonly created: boolean;
  /** The source field written to each target column. */
  readonly fields: readonly number[];
  readonly transaction: ImportTransaction;
  readonly errors: ImportErrorPolicy;
  open(): Promise<ImportSession>;
}

export type ImportListener = (event: ImportEvent) => void;

export interface ImportTasks {
  start(job: ImportJob, stallMs: number): ImportTask;
  get(taskId: string): ImportTask | undefined;
  cancel(taskId: string): void;
  /** Runs a finished task's job again as a new task, from the row its last commit did not cover. */
  resume(taskId: string, stallMs: number): ImportTask;
  list(): ImportTask[];
  subscribe(listener: ImportListener): () => void;
  /** Resolves once no task runs, including tasks started while it waited. */
  settled(): Promise<void>;
  /** Cancels what runs, so each rolls back, and waits for them. */
  close(): Promise<void>;
}

export interface ImportTasksOptions {
  readonly clock?: ExportClock;
  readonly chunks?: (file: string) => AsyncIterable<Uint8Array>;
  /** How each task ended: counts only, never the path, the table or a value (decision 038). */
  readonly log?: Pick<Logger, "info" | "warn">;
}

interface Running {
  task: ImportTask;
  readonly job: ImportJob;
  readonly controller: AbortController;
  done: Promise<void>;
}

const ERROR_CODES: Readonly<Record<ImportFailureReason, EngineErrorCode>> = {
  stalled: "timedOut",
  cancelled: "cancelled",
  badRow: "importFailed",
  tooManyRejected: "importFailed",
  file: "importFailed",
  target: "importFailed",
};

function withinGrace(pending: Promise<void>, clock: ExportClock): Promise<void> {
  return new Promise((resolve) => {
    const timer = clock.setTimeout(resolve, SESSION_CLOSE_GRACE_MS);
    void pending.finally(() => {
      clock.clearTimeout(timer);
      resolve();
    });
  });
}

const SILENT: Pick<Logger, "info" | "warn"> = { info: () => undefined, warn: () => undefined };

/** The engine's import tasks (decision 046), one table for the whole engine like exports'. */
export function importTasks(options: ImportTasksOptions = {}): ImportTasks {
  const clock = options.clock ?? systemClock;
  const chunks = options.chunks ?? fileChunks;
  const log = options.log ?? SILENT;
  const tasks = new Map<string, Running>();
  const listeners = new Set<ImportListener>();
  let next = 1;

  function emit(type: ImportEventType, task: ImportTask): void {
    const event: ImportEvent = { id: null, type, task };
    for (const listener of listeners) listener(event);
  }

  async function run(entry: Running, stallMs: number): Promise<void> {
    const { job, controller } = entry;
    const { taskId } = entry.task;
    const skipRows = entry.task.resumeFrom - 1;
    const started = clock.now();
    let session: ImportSession | null = null;
    let finished = false;
    let closing: Promise<void> | null = null;
    let rejected: RejectedFile | null = null;
    const closeSession = (): Promise<void> => {
      closing ??= session === null ? Promise.resolve() : session.close().catch(() => undefined);
      return closing;
    };
    const update = (patch: Partial<ImportTask>): void => {
      entry.task = { ...entry.task, ...patch };
    };

    let type: ImportEventType;
    try {
      if (job.errors.mode === "skip") rejected = await openRejectedFile(rejectedPathOf(job.file), skipRows > 0);
      const nothing = {
        read: 0,
        written: 0,
        committed: 0,
        rejected: 0,
        resumeFrom: entry.task.resumeFrom,
        ambiguous: false,
      };
      const opening = job.open();
      // A connect that answers after a cancel is closed, not leaked.
      void opening.then(
        (opened) => {
          if (finished) void opened.close().catch(() => undefined);
        },
        () => undefined,
      );
      try {
        session = await Promise.race([opening, aborted(controller.signal)]);
      } catch (cause) {
        if (controller.signal.aborted) {
          throw new ImportError("cancelled", "Import cancelled before any row was written.", CANCEL_HINT, nothing);
        }
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new ImportError("target", `The import could not connect: ${message}`, CONNECT_HINT, nothing);
      }
      const result = await runImport({
        source: chunks(job.file),
        format: job.format,
        fields: job.fields,
        skipRows,
        transaction: job.transaction,
        errors: job.errors,
        writer: session.writer,
        rejected,
        signal: controller.signal,
        stallMs,
        clock,
        onProgress: (progress) => {
          update(progress);
          emit("import.progress", entry.task);
        },
        onStall: () => void closeSession(),
      });
      type = "import.done";
      update({
        state: "done",
        bytes: result.bytes,
        written: result.written,
        committed: result.committed,
        rejected: result.rejected,
        resumeFrom: result.resumeFrom,
      });
    } catch (cause) {
      const error =
        cause instanceof ImportError
          ? cause
          : new ImportError("target", cause instanceof Error ? cause.message : String(cause), UNEXPECTED_HINT, {
              read: 0,
              written: entry.task.written,
              committed: entry.task.committed,
              rejected: entry.task.rejected,
              resumeFrom: entry.task.resumeFrom,
              ambiguous: false,
            });
      const cancelled = error.reason === "cancelled";
      type = cancelled ? "import.cancelled" : "import.failed";
      update({
        state: cancelled ? "cancelled" : "failed",
        written: error.counts.written,
        committed: error.counts.committed,
        rejected: error.counts.rejected,
        resumeFrom: error.counts.resumeFrom,
        ambiguous: error.counts.ambiguous,
        error: { code: ERROR_CODES[error.reason], message: error.message, hint: error.hint, reason: error.reason },
      });
    } finally {
      finished = true;
    }
    await withinGrace(closeSession(), clock);
    if (rejected !== null) {
      const kept = rejected.bytes > 0;
      await rejected.close().catch(() => undefined);
      update({ rejectedFile: kept ? rejected.path : null });
    }
    update({ elapsedMs: clock.now() - started });
    const { task } = entry;
    const fields = {
      taskId,
      transaction: task.transaction.mode,
      written: task.written,
      committed: task.committed,
      rejected: task.rejected,
      resumeFrom: task.resumeFrom,
      bytes: task.bytes,
      size: task.size,
      elapsedMs: task.elapsedMs,
    };
    if (task.state === "done") log.info("import finished", fields);
    else if (task.state === "cancelled") log.info("import cancelled", fields);
    // The message can quote a refused value; the reason and the counts say enough (decision 038).
    else log.warn("import failed", { ...fields, reason: task.error?.reason, ambiguous: task.ambiguous });
    emit(type, task);
  }

  function start(job: ImportJob, stallMs: number, resumeFrom = 1): ImportTask {
    const taskId = `${TASK_PREFIX}${String(next++)}-${randomBytes(TASK_ID_RANDOM_BYTES).toString("hex")}`;
    const entry: Running = {
      job,
      controller: new AbortController(),
      done: Promise.resolve(),
      task: {
        taskId,
        file: job.file,
        table: job.table,
        state: "running",
        transaction: job.transaction,
        bytes: 0,
        size: job.size,
        written: 0,
        committed: 0,
        rejected: 0,
        elapsedMs: 0,
        resumeFrom,
        ambiguous: false,
        created: job.created,
        rejectedFile: null,
        error: null,
      },
    };
    tasks.set(taskId, entry);
    entry.done = run(entry, stallMs);
    return entry.task;
  }

  return {
    start: (job, stallMs) => start(job, stallMs),
    get: (taskId) => tasks.get(taskId)?.task,
    cancel(taskId) {
      tasks.get(taskId)?.controller.abort();
    },
    resume(taskId, stallMs) {
      const entry = tasks.get(taskId);
      if (entry === undefined) throw new Error(`No import task "${taskId}".`);
      return start(entry.job, stallMs, entry.task.resumeFrom);
    },
    list: () => [...tasks.values()].map((entry) => entry.task),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async settled() {
      for (;;) {
        const running = [...tasks.values()].filter((entry) => entry.task.state === "running");
        if (running.length === 0) return;
        await Promise.allSettled(running.map((entry) => entry.done));
      }
    },
    async close() {
      const running = [...tasks.values()];
      for (const entry of running) entry.controller.abort();
      await Promise.allSettled(running.map((entry) => entry.done));
    },
  };
}
