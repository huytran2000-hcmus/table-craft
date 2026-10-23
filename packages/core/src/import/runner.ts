import type { InsertRow } from "@table-craft/plugin-api";
import { durationText, systemClock, type ExportClock } from "@table-craft/core/export/runner.js";
import { CsvError, CsvReader, type CsvRecord } from "@table-craft/core/import/csv.js";
import { DecodeError, importDecoder } from "@table-craft/core/import/decode.js";
import {
  ImportError,
  RowsRefused,
  type ImportCounts,
  type ImportFailureReason,
} from "@table-craft/core/import/errors.js";
import type { ImportFormat } from "@table-craft/core/import/format.js";
import { rejectedHeader, rejectedLine } from "@table-craft/core/import/rejected.js";

/** Rows sent in one `insertRows` call at most (plan 021, ruling 6). */
export const IMPORT_BATCH_ROWS = 1_000;
/** Characters of field text sent in one call at most, so wide rows make smaller batches. */
export const IMPORT_BATCH_CHARS = 1024 ** 2;
/** At most one progress report per this many milliseconds, as for exports (decision 040). */
export const IMPORT_PROGRESS_INTERVAL_MS = 250;

const TRAILING_STOP = /\.$/u;
const STALL_HINT =
  "Check the network and the server. If the database is slow to take rows, raise Transfer stall timeout in Settings.";
const CANCEL_HINT = "Import again when you are ready.";
const BAD_ROW_HINT = "Fix the row or the column mapping, or choose Skip under Bad rows, then import again.";
const TOO_MANY_HINT =
  "Check the delimiter, quote and header options and the column mapping; the rejected rows and their reasons are in the rejected file.";
const FILE_HINT = "Check the format options (encoding, delimiter, quote) against the file.";
const RETRY_HINT = "Check the connection and the table, then choose Retry.";
const RESUME_HINT = "Check the connection and the table, then choose Resume.";

/** The database side of an import: one session, in a transaction the runner commits. */
export interface ImportWriter {
  /** Atomic; rejects with `RowsRefused` when the database refused a row, with anything else when the session failed. */
  insert(rows: readonly InsertRow[]): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/** Where rejected rows go; `truncate` drops what was written after a mark (plan 021, ruling 12). */
export interface RejectedSink {
  /** Bytes in the file, including what an earlier run left there. */
  readonly bytes: number;
  write(text: string): Promise<void>;
  truncate(bytes: number): Promise<void>;
}

export type ImportTransaction = { readonly mode: "all" } | { readonly mode: "every"; readonly rows: number };

export type ImportErrorPolicy = { readonly mode: "stop" } | { readonly mode: "skip"; readonly limit: number };

export interface ImportProgress {
  /** Bytes of the file read so far. */
  readonly bytes: number;
  readonly written: number;
  readonly committed: number;
  readonly rejected: number;
  readonly elapsedMs: number;
}

export type ImportOutcome = ImportProgress & ImportCounts;

export interface RunImportOptions {
  readonly source: AsyncIterable<Uint8Array>;
  readonly format: ImportFormat;
  /** The source field written to each target column, in the target's column order. */
  readonly fields: readonly number[];
  /** Data rows a resumed import passes over: an earlier run committed them. */
  readonly skipRows: number;
  readonly transaction: ImportTransaction;
  readonly errors: ImportErrorPolicy;
  readonly writer: ImportWriter;
  /** Required with the `skip` policy. */
  readonly rejected: RejectedSink | null;
  readonly signal: AbortSignal;
  /** A database call that does not answer for this long fails the import as stalled. */
  readonly stallMs: number;
  readonly clock?: ExportClock;
  readonly progressIntervalMs?: number;
  readonly batchRows?: number;
  readonly batchChars?: number;
  readonly onProgress?: (progress: ImportProgress) => void;
  /** Called when the watchdog fires, before the import fails: closes the session that never answered. */
  readonly onStall?: () => void;
}

interface Pending {
  readonly values: InsertRow;
  readonly record: CsvRecord;
  readonly row: number;
}

class Interrupted extends Error {
  constructor(readonly reason: "stalled" | "cancelled") {
    super(reason);
  }
}

/** A row the policy does not let through; `reason` already names the row. */
class Stopped extends Error {
  constructor(
    readonly reason: "badRow" | "tooManyRejected",
    message: string,
  ) {
    super(message);
  }
}

function count(rows: number, singular = "row", plural = "rows"): string {
  return `${rows.toLocaleString("en-US")} ${rows === 1 ? singular : plural}`;
}

/** What the database kept, said in full (decision 046). */
export function keptText(counts: ImportCounts, transaction: ImportTransaction): string {
  const uncertain = counts.written - counts.committed;
  if (counts.ambiguous) {
    if (transaction.mode === "all") {
      return `The answer to the final commit was lost: the ${count(uncertain)} may or may not be kept; check the table before importing again.`;
    }
    return `${count(counts.committed)} ${counts.committed === 1 ? "is" : "are"} committed; the last commit's ${count(uncertain)} may or may not be. Check the table before resuming from row ${counts.resumeFrom.toLocaleString("en-US")}.`;
  }
  if (transaction.mode === "all") return "Nothing was imported: the transaction was rolled back.";
  if (counts.committed === 0) return "No rows were committed.";
  return `${count(counts.committed)} ${counts.committed === 1 ? "is" : "are"} committed; resume from row ${counts.resumeFrom.toLocaleString("en-US")}.`;
}

/**
 * Reads `source` as delimited text and writes its rows through `writer` in batches (decision 046).
 * Only one batch is held at a time, so memory does not grow with the file. Every database call is
 * raced against the stall watchdog, and all but the commit against `signal`. On any failure the
 * open transaction is rolled back, the rejected file is cut back to the last commit, and the error
 * is an `ImportError` whose counts say exactly what was committed.
 */
export async function runImport(options: RunImportOptions): Promise<ImportOutcome> {
  const clock = options.clock ?? systemClock;
  const interval = options.progressIntervalMs ?? IMPORT_PROGRESS_INTERVAL_MS;
  const batchRows = options.batchRows ?? IMPORT_BATCH_ROWS;
  const batchChars = options.batchChars ?? IMPORT_BATCH_CHARS;
  const { signal, writer, transaction, errors, format } = options;
  const every = transaction.mode === "every" ? Math.max(1, transaction.rows) : null;
  const started = clock.now();
  const reader = new CsvReader(format);
  const decoder = importDecoder(format.encoding);

  let bytes = 0;
  let read = 0;
  let written = 0;
  let committed = 0;
  let rejected = 0;
  let dataRow = 0;
  let handledAtCommit = options.skipRows;
  let rejectedAtCommit = 0;
  let rejectedMark = options.rejected?.bytes ?? 0;
  let ambiguous = false;
  let names: readonly string[] | null = null;
  let batch: Pending[] = [];
  let pendingChars = 0;
  let lastReport = started;

  const counts = (): ImportCounts => ({
    read,
    written,
    committed,
    rejected,
    resumeFrom: handledAtCommit + 1,
    ambiguous,
  });

  function watched<T>(pending: Promise<T>, abortable: boolean): Promise<T> {
    // The abandoned promise may reject later, when its session closes; nobody waits for it.
    pending.catch(() => undefined);
    return new Promise<T>((resolve, reject) => {
      const timer = clock.setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        reject(new Interrupted("stalled"));
      }, options.stallMs);
      function onAbort(): void {
        clock.clearTimeout(timer);
        reject(new Interrupted("cancelled"));
      }
      if (abortable) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }
      pending.then(
        (value) => {
          clock.clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (cause: unknown) => {
          clock.clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          reject(cause instanceof Error ? cause : new Error(String(cause)));
        },
      );
    });
  }

  function report(force: boolean): void {
    const at = clock.now();
    if (!force && at - lastReport < interval) return;
    lastReport = at;
    options.onProgress?.({ bytes, written, committed, rejected, elapsedMs: at - started });
  }

  async function reject(pending: Pick<Pending, "record" | "row">, reason: string): Promise<void> {
    const where = `Row ${pending.row.toLocaleString("en-US")} (line ${pending.record.line.toLocaleString("en-US")})`;
    const message = `${where}: ${reason.replace(TRAILING_STOP, "")}`;
    if (errors.mode === "stop") throw new Stopped("badRow", message);
    rejected += 1;
    if (rejected > errors.limit) {
      throw new Stopped(
        "tooManyRejected",
        `More than ${count(errors.limit)} were rejected; the last, ${message.charAt(0).toLowerCase()}${message.slice(1)}`,
      );
    }
    const sink = options.rejected;
    if (sink === null) throw new Error("Skipping bad rows needs a rejected file.");
    if (sink.bytes === 0) await sink.write(rejectedHeader(names ?? []));
    await sink.write(rejectedLine(pending.record, reason));
  }

  async function flush(): Promise<void> {
    if (batch.length === 0) return;
    const rows = batch;
    batch = [];
    pendingChars = 0;
    try {
      await watched(writer.insert(rows.map((pending) => pending.values)), true);
      written += rows.length;
    } catch (cause) {
      if (!(cause instanceof RowsRefused)) throw cause;
      if (rows.length === 1 && rows[0] !== undefined) {
        await reject(rows[0], cause.message);
      } else {
        // The batch was atomic, so nothing of it is kept: find the culprits one row at a time.
        for (const pending of rows) {
          try {
            await watched(writer.insert([pending.values]), true);
            written += 1;
          } catch (single) {
            if (!(single instanceof RowsRefused)) throw single;
            await reject(pending, single.message);
          }
        }
      }
    }
    report(false);
  }

  async function commit(): Promise<void> {
    await flush();
    try {
      await watched(writer.commit(), false);
    } catch (cause) {
      ambiguous = written > committed;
      throw cause;
    }
    committed = written;
    handledAtCommit = dataRow;
    rejectedAtCommit = rejected;
    rejectedMark = options.rejected?.bytes ?? 0;
    // Every commit is reported, so a window that loses the engine still knows what was kept.
    report(true);
  }

  async function take(record: CsvRecord): Promise<void> {
    if (names === null) {
      names = record.fields.map((field, index) =>
        format.header && field !== null && field !== "" ? field : `column_${String(index + 1)}`,
      );
      if (format.header) return;
    }
    dataRow += 1;
    if (dataRow <= options.skipRows) return;
    read += 1;
    if (record.fields.length !== names.length) {
      const expected = `${format.header ? "the header has" : "the first row has"} ${String(names.length)}`;
      await reject({ record, row: dataRow }, `it has ${count(record.fields.length, "field", "fields")}; ${expected}`);
      return;
    }
    const values = options.fields.map((index) => record.fields[index] ?? null);
    batch.push({ values, record, row: dataRow });
    for (const value of values) pendingChars += value?.length ?? 0;
    const room = every === null ? batchRows : Math.min(batchRows, every - (written - committed));
    if (batch.length >= room || pendingChars >= batchChars) await flush();
    if (every !== null && written - committed >= every) await commit();
  }

  try {
    for await (const chunk of options.source) {
      if (signal.aborted) throw new Interrupted("cancelled");
      bytes += chunk.length;
      for (const record of reader.push(decoder.push(chunk))) await take(record);
      report(false);
    }
    for (const record of reader.push(decoder.end())) await take(record);
    for (const record of reader.end()) await take(record);
    if (signal.aborted) throw new Interrupted("cancelled");
    await commit();
  } catch (cause) {
    const stalled = cause instanceof Interrupted && cause.reason === "stalled";
    if (stalled) options.onStall?.();
    else await watched(writer.rollback(), false).catch(() => undefined);
    await options.rejected?.truncate(rejectedMark).catch(() => undefined);
    rejected = rejectedAtCommit;
    throw failure(cause, counts(), options);
  }
  const elapsedMs = clock.now() - started;
  options.onProgress?.({ bytes, written, committed, rejected, elapsedMs });
  return { ...counts(), bytes, elapsedMs };
}

function failure(cause: unknown, counts: ImportCounts, options: RunImportOptions): ImportError {
  const kept = keptText(counts, options.transaction);
  const make = (reason: ImportFailureReason, message: string, hint: string): ImportError =>
    new ImportError(reason, `${message.replace(TRAILING_STOP, "")}. ${kept}`, hint, counts, cause);
  const retry = options.transaction.mode === "every" && counts.committed > 0 ? RESUME_HINT : RETRY_HINT;
  if (cause instanceof Interrupted && cause.reason === "stalled") {
    return make(
      "stalled",
      `The server answered nothing for ${durationText(options.stallMs)}; the network or the server stalled`,
      STALL_HINT,
    );
  }
  if (cause instanceof Interrupted) return make("cancelled", "Import cancelled", CANCEL_HINT);
  if (cause instanceof Stopped)
    return make(cause.reason, cause.message, cause.reason === "badRow" ? BAD_ROW_HINT : TOO_MANY_HINT);
  if (cause instanceof CsvError || cause instanceof DecodeError) return make("file", cause.message, FILE_HINT);
  const message = cause instanceof Error ? cause.message : String(cause);
  return make("target", `The import stopped: ${message}`, retry);
}
