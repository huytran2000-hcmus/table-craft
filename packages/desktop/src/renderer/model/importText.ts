import type { ExportTaskState, ImportTask } from "@table-craft/desktop/engine/protocol.js";
import { fileNameOf } from "@table-craft/desktop/renderer/model/exportText.js";
import { formatBytes, formatCount, formatDuration } from "@table-craft/desktop/renderer/model/format.js";

const PERCENT = 100;

/** How a Services import line words its state. */
export const IMPORT_STATE_TEXT: Readonly<Record<ExportTaskState, string>> = {
  running: "importing",
  done: "done",
  failed: "failed",
  cancelled: "cancelled",
};

/** Whole percent of the file read; null for an empty file. */
export function importPercent(task: Pick<ImportTask, "bytes" | "size">): number | null {
  if (task.size <= 0) return null;
  return Math.min(PERCENT, Math.floor((task.bytes / task.size) * PERCENT));
}

function rows(count: number): string {
  return `${formatCount(count)} ${count === 1 ? "row" : "rows"}`;
}

/**
 * An import line's detail: `12,345 rows · 4.1 MB of 9.8 MB · 3.2 s` while running, what was
 * written (or committed, when it did not finish) once it ends.
 */
export function importProgressText(task: ImportTask): string {
  if (task.state === "running") {
    return [
      rows(task.written),
      `${formatBytes(task.bytes)} of ${formatBytes(task.size)}`,
      formatDuration(task.elapsedMs),
    ].join(" · ");
  }
  if (task.state === "done") return [`${rows(task.written)} imported`, formatDuration(task.elapsedMs)].join(" · ");
  return [`${rows(task.committed)} committed`, formatDuration(task.elapsedMs)].join(" · ");
}

/** What else an import line says: rejected rows and where they went, a table it created. */
export function importNotes(task: ImportTask): readonly string[] {
  const notes: string[] = [];
  if (task.rejected > 0) {
    const where = task.rejectedFile === null ? "" : ` into ${fileNameOf(task.rejectedFile)}`;
    notes.push(`${rows(task.rejected)} rejected${where}`);
  }
  if (task.created) notes.push(task.state === "done" ? "table created" : "the created table stays");
  return notes;
}

/** The status bar's item while imports run: `Importing 2 · 41%` when one runs. */
export function importingText(running: readonly ImportTask[]): string {
  const percent = running.length === 1 && running[0] !== undefined ? importPercent(running[0]) : null;
  const count = `Importing ${formatCount(running.length)}`;
  return percent === null ? count : `${count} · ${String(percent)}%`;
}
