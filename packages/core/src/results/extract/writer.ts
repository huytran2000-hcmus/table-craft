import type { Row } from "@table-craft/plugin-api";

/** A format written piece by piece, so an export streams instead of building one string. */
export interface RowWriter {
  start(): string;
  /** `index` counts rows from 0 across the whole extract. */
  row(row: Row, index: number): string;
  /** `count` is how many rows were written. */
  end(count: number): string;
}
