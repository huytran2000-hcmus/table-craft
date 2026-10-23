import type { Column } from "@table-craft/plugin-api";
import type { ExportEncoder } from "@table-craft/core/export/runner.js";
import { xlsxEncoder, type XlsxOptions } from "@table-craft/core/export/xlsx.js";
import { EXTRACTOR_KINDS, rowWriter, type ExtractOptions } from "@table-craft/core/results/extract/index.js";

/** What Export writes: every Copy format, plus `xlsx`, which only makes sense as a file. */
export const EXPORT_FORMATS = [...EXTRACTOR_KINDS, "xlsx"] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export type ExportEncoderOptions = ExtractOptions & XlsxOptions;

export function exportEncoder(
  format: ExportFormat,
  columns: readonly Column[],
  options: ExportEncoderOptions = {},
): ExportEncoder {
  if (format === "xlsx") return xlsxEncoder(columns, options);
  const writer = rowWriter(format, columns, options);
  return {
    sheets: 0,
    truncatedCells: 0,
    start: () => writer.start(),
    row: (row, index) => writer.row(row, index),
    end: (count) => writer.end(count),
  };
}

export { EXPORT_FAILURE_REASONS, ExportError, type ExportFailureReason } from "@table-craft/core/export/errors.js";
export {
  PART_SUFFIX,
  SINK_BATCH_BYTES,
  byteSize,
  nodeSinkFiles,
  openFileSink,
  partPathOf,
  type FileSink,
  type SinkFile,
  type SinkFiles,
} from "@table-craft/core/export/fileSink.js";
export {
  EXPORT_PROGRESS_INTERVAL_MS,
  durationText,
  runExport,
  systemClock,
  type ExportClock,
  type ExportEncoder,
  type ExportOutcome,
  type ExportProgress,
  type RunExportOptions,
} from "@table-craft/core/export/runner.js";
export {
  XLSX_CELL_CHARS,
  XLSX_SHEET_ROWS,
  columnLetters,
  xlsxEncoder,
  xmlText,
} from "@table-craft/core/export/xlsx.js";
export { ZIP32_MAX, zipWriter, type ZipOptions, type ZipWriter } from "@table-craft/core/export/zip.js";
