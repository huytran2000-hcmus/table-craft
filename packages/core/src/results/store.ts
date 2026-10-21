import type { Column, ExecuteResult, Row } from "@table-craft/plugin-api";
import { CoreError } from "@table-craft/core/errors.js";

/** Rows per window the grid requests; desktop's protocol pins the same value (decision 009). */
export const RESULT_WINDOW_ROWS = 500;
/** Rows kept per result; the rest are never fetched, and the result is marked truncated. */
export const RESULT_FETCH_CAP = 10_000;

export type ResultHandle = string;

export interface ResultSummary {
  readonly handle: ResultHandle;
  readonly columns: readonly Column[];
  readonly rowCount: number;
  /** The statement produced more than `RESULT_FETCH_CAP` rows; only the first are kept. */
  readonly truncated: boolean;
  readonly rowsAffected: number | null;
}

export interface ResultWindow {
  readonly offset: number;
  readonly rows: readonly Row[];
}

interface StoredResult {
  readonly columns: readonly Column[];
  readonly rows: readonly Row[];
}

const HANDLE_PREFIX = "result-";

/** Holds result rows by handle so only windows of them ever leave the process. */
export class ResultStore {
  readonly #results = new Map<ResultHandle, StoredResult>();
  readonly #fetchCap: number;
  #nextHandle = 1;

  constructor(fetchCap: number = RESULT_FETCH_CAP) {
    this.#fetchCap = fetchCap;
  }

  /** Drains up to the fetch cap from `result.rows`, then stops the iterator. */
  async put(result: ExecuteResult): Promise<ResultSummary> {
    const rows: Row[] = [];
    let truncated = false;
    const iterator = result.rows[Symbol.asyncIterator]();
    try {
      for (;;) {
        const next = await iterator.next();
        if (next.done === true) break;
        if (rows.length === this.#fetchCap) {
          truncated = true;
          break;
        }
        rows.push(next.value);
      }
    } finally {
      await iterator.return?.();
    }
    const handle = `${HANDLE_PREFIX}${this.#nextHandle++}`;
    this.#results.set(handle, { columns: result.columns, rows });
    return { handle, columns: result.columns, rowCount: rows.length, truncated, rowsAffected: result.rowsAffected };
  }

  /** At most `RESULT_WINDOW_ROWS` rows from `offset`; fewer at the end of the result. */
  window(handle: ResultHandle, offset: number, limit: number = RESULT_WINDOW_ROWS): ResultWindow {
    const stored = this.#results.get(handle);
    if (stored === undefined) {
      throw new CoreError(
        "unknownHandle",
        `No result with handle "${handle}"; it was released or never existed.`,
        "Run the statement again.",
      );
    }
    const start = Math.max(0, offset);
    const count = Math.max(0, Math.min(limit, RESULT_WINDOW_ROWS));
    return { offset: start, rows: stored.rows.slice(start, start + count) };
  }

  /** Releasing an unknown handle is a no-op, so a renderer may release twice. */
  release(handle: ResultHandle): void {
    this.#results.delete(handle);
  }

  get size(): number {
    return this.#results.size;
  }
}
