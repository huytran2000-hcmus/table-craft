import type { InferredColumn } from "@table-craft/plugin-api";
import { CsvReader, type CsvRecord } from "@table-craft/core/import/csv.js";
import { importDecoder } from "@table-craft/core/import/decode.js";
import type { ImportFormat } from "@table-craft/core/import/format.js";
import { INFERENCE_SAMPLE_ROWS, inferColumns } from "@table-craft/core/import/infer.js";

/** Rows the dialog shows (plan 021, ruling 1). */
export const PREVIEW_ROWS = 100;
/** The preview stops reading here even when the sample is short, so a huge first record cannot stall it. */
export const PREVIEW_MAX_BYTES = 8 * 1024 ** 2;

export interface FilePreview {
  /** From the header, or `column_1`…; one per field of the first record. */
  readonly names: readonly string[];
  /** The first data rows as read. */
  readonly rows: readonly (readonly (string | null)[])[];
  /** Inferred from up to `INFERENCE_SAMPLE_ROWS` data rows of the right width. */
  readonly columns: readonly InferredColumn[];
  /** The encoding the file was read with, once `auto` resolved it. */
  readonly encoding: string | null;
  /** Data rows of the sample whose field count differs from the header's. */
  readonly ragged: number;
}

/**
 * The head of a file as `format` reads it (plan 021, ruling 1). Reads only until the sample is full;
 * leaving the loop early returns the source's iterator, which closes the file.
 */
export async function previewFile(source: AsyncIterable<Uint8Array>, format: ImportFormat): Promise<FilePreview> {
  const reader = new CsvReader(format);
  const decoder = importDecoder(format.encoding);
  const sample: (readonly (string | null)[])[] = [];
  let names: string[] | null = null;
  let ragged = 0;
  let bytes = 0;
  let ended = true;

  function take(record: CsvRecord): void {
    if (names === null) {
      names = record.fields.map((field, index) =>
        format.header && field !== null && field !== "" ? field : `column_${String(index + 1)}`,
      );
      if (format.header) return;
    }
    if (record.fields.length !== names.length) ragged += 1;
    sample.push(record.fields);
  }

  for await (const chunk of source) {
    bytes += chunk.length;
    for (const record of reader.push(decoder.push(chunk))) take(record);
    if (sample.length >= INFERENCE_SAMPLE_ROWS || bytes >= PREVIEW_MAX_BYTES) {
      ended = false;
      break;
    }
  }
  if (ended) {
    for (const record of reader.push(decoder.end())) take(record);
    for (const record of reader.end()) take(record);
  }
  const width = (names as string[] | null)?.length ?? 0;
  const regular = sample.filter((row) => row.length === width).slice(0, INFERENCE_SAMPLE_ROWS);
  return {
    names: names ?? [],
    rows: sample.slice(0, PREVIEW_ROWS),
    columns: inferColumns(regular, width),
    encoding: decoder.encoding,
    ragged,
  };
}
