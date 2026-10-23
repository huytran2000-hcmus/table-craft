import type { ExportTask, ExportTaskState } from "@table-craft/desktop/engine/protocol.js";
import { formatBytes, formatCount, formatDuration } from "@table-craft/desktop/renderer/model/format.js";

const PERCENT = 100;
const PATH_SEPARATOR = /[\\/]/;

/** How a Services export line words its state. */
export const EXPORT_STATE_TEXT: Readonly<Record<ExportTaskState, string>> = {
  running: "exporting",
  done: "done",
  failed: "failed",
  cancelled: "cancelled",
};

/** The file's name without its folder: what an export line shows, the full path in its tooltip. */
export function fileNameOf(path: string): string {
  return path.split(PATH_SEPARATOR).pop() ?? path;
}

/** Whole percent of the estimate, or null when there is none to measure against. */
export function exportPercent(task: Pick<ExportTask, "rows" | "estimate">): number | null {
  if (task.estimate === null || task.estimate <= 0) return null;
  return Math.min(PERCENT, Math.floor((task.rows / task.estimate) * PERCENT));
}

/**
 * An export line's detail: `12,345 of 50,000 rows · 4.1 MB · 3.2 s` while running against an
 * estimate, `12,345 rows · 4.1 MB · 3.2 s` otherwise.
 */
export function exportProgressText(task: ExportTask): string {
  const rows =
    task.state === "running" && task.estimate !== null
      ? `${formatCount(task.rows)} of ${formatCount(task.estimate)} rows`
      : `${formatCount(task.rows)} ${task.rows === 1 ? "row" : "rows"}`;
  return [rows, formatBytes(task.bytes), formatDuration(task.elapsedMs)].join(" · ");
}

/** What else a finished export says: the warning, cells cut to fit, bytes shown as previews. */
export function exportNotes(task: ExportTask): readonly string[] {
  const notes: string[] = [];
  if (task.warning !== null) notes.push(task.warning);
  if (task.sheets > 1) notes.push(`${formatCount(task.sheets)} sheets`);
  if (task.truncatedCells > 0) notes.push(`${formatCount(task.truncatedCells)} cells cut to the format's limit`);
  if (task.clippedBytes > 0) {
    notes.push(
      `${formatCount(task.clippedBytes)} binary values exported as previews; export the table for full values`,
    );
  }
  return notes;
}

/** The status bar's item while exports run: `Exporting 2 · 41%` when one estimate is known. */
export function exportingText(running: readonly ExportTask[]): string {
  const percent = running.length === 1 && running[0] !== undefined ? exportPercent(running[0]) : null;
  const count = `Exporting ${formatCount(running.length)}`;
  return percent === null ? count : `${count} · ${String(percent)}%`;
}
