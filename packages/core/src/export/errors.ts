export const EXPORT_FAILURE_REASONS = ["stalled", "diskFull", "cancelled", "source", "file"] as const;

/** Why an export stopped short: the network or server, the disk, the user, or the file itself. */
export type ExportFailureReason = (typeof EXPORT_FAILURE_REASONS)[number];

/** An export that did not finish; nothing was left at the target (decision 040). */
export class ExportError extends Error {
  override readonly name = "ExportError";

  constructor(
    readonly reason: ExportFailureReason,
    message: string,
    readonly hint: string,
    /** Rows written to the temporary file before the export stopped. */
    readonly rows: number = 0,
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}
