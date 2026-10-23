export const IMPORT_FAILURE_REASONS = ["stalled", "cancelled", "badRow", "tooManyRejected", "file", "target"] as const;

/**
 * Why an import stopped short: the network or server went quiet, the user, a row the database or
 * the reader refused, more rejected rows than allowed, the file itself, or the database.
 */
export type ImportFailureReason = (typeof IMPORT_FAILURE_REASONS)[number];

/** Where an import stood when it ended; every count is in data rows, the header excluded. */
export interface ImportCounts {
  /** Data rows read past the skipped ones. */
  readonly read: number;
  /** Rows the database accepted, committed or not. */
  readonly written: number;
  /** Rows certainly committed. */
  readonly committed: number;
  /** Rows written to the rejected file and kept there: rejections of rolled-back work are dropped. */
  readonly rejected: number;
  /** The data row an import resuming this one starts at: the first one the last commit did not cover. */
  readonly resumeFrom: number;
  /** A commit was sent and its answer lost: its rows may or may not be kept (plan 021, ruling 11). */
  readonly ambiguous: boolean;
}

/** An import that did not finish; `counts` says what the database kept (decision 046). */
export class ImportError extends Error {
  override readonly name = "ImportError";

  constructor(
    readonly reason: ImportFailureReason,
    message: string,
    readonly hint: string,
    readonly counts: ImportCounts,
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}

/** Thrown by an `ImportWriter` when the database refused a batch's content, not its connection. */
export class RowsRefused extends Error {
  override readonly name = "RowsRefused";
}
