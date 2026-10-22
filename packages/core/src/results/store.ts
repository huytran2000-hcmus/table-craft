import type { Column, ExecuteResult, Row } from "@table-craft/plugin-api";
import { CoreError } from "@table-craft/core/errors.js";
import { compareValues, inferredTypeClass, typeClass, type TypeClass } from "@table-craft/core/results/compare.js";

/** Rows per window the grid requests; desktop's protocol pins the same value (decision 009). */
export const RESULT_WINDOW_ROWS = 500;
/** Rows read when a statement runs and on each Fetch Next Page (decision 025). */
export const RESULT_PAGE_ROWS = 500;
/** Rows a result may hold; Fetch All stops here and closes the cursor (decision 025). */
export const RESULT_FETCH_ALL_CAP = 100_000;

export type ResultHandle = string;

/** How far a result has been read, and whether more can be. */
export interface ResultState {
  readonly rowCount: number;
  /** Every row the statement produced is held. */
  readonly complete: boolean;
  /** Fetch Next Page and Fetch All can still read more. */
  readonly cursorOpen: boolean;
}

export interface ResultSummary extends ResultState {
  readonly handle: ResultHandle;
  readonly columns: readonly Column[];
  /** Each column's class, so the grid draws its glyph without a classifier of its own. */
  readonly typeClasses: readonly TypeClass[];
  readonly rowsAffected: number | null;
}

export interface ResultWindow {
  readonly offset: number;
  readonly rows: readonly Row[];
}

export type SortDirection = "asc" | "desc";

export interface SortKey {
  /** Index into the result's columns. */
  readonly column: number;
  readonly direction: SortDirection;
}

export interface ResultLimits {
  readonly pageRows: number;
  readonly fetchAllCap: number;
}

/** Limits given with a call win over the store's own (decision 032: paging travels with each request). */
export interface FetchOptions extends Partial<ResultLimits> {
  /** Read to the end, or to the Fetch All cap, instead of one page. */
  readonly all: boolean;
}

const DEFAULT_LIMITS: ResultLimits = { pageRows: RESULT_PAGE_ROWS, fetchAllCap: RESULT_FETCH_ALL_CAP };

interface StoredResult {
  readonly columns: readonly Column[];
  classes: readonly TypeClass[];
  readonly rows: Row[];
  /** Open until the rows run out, the cap is reached, or the session moves on. */
  iterator: AsyncIterator<Row> | null;
  /** Read past the last held row, so `complete` is known without another round trip. */
  lookahead: { readonly row: Row } | null;
  complete: boolean;
  keys: readonly SortKey[];
  /** Positions in `rows` in sorted order; null when unsorted or stale after a fetch. */
  order: number[] | null;
  /** The fetch in flight, so fetches on one handle run one after another. */
  fetching: Promise<unknown>;
  /** Raised by `stopFetch` and `closeCursor`; the running fetch checks it between rows. */
  stopRequested: boolean;
}

const HANDLE_PREFIX = "result-";

function definedLimits(options: Partial<ResultLimits>): Partial<ResultLimits> {
  return {
    ...(options.pageRows === undefined ? {} : { pageRows: options.pageRows }),
    ...(options.fetchAllCap === undefined ? {} : { fetchAllCap: options.fetchAllCap }),
  };
}

function unknownHandle(handle: ResultHandle): CoreError {
  return new CoreError(
    "unknownHandle",
    `No result with handle "${handle}"; it was released or never existed.`,
    "Run the statement again.",
  );
}

function stateOf(stored: StoredResult): ResultState {
  return { rowCount: stored.rows.length, complete: stored.complete, cursorOpen: stored.iterator !== null };
}

/**
 * Holds result rows by handle so only windows of them ever leave the process. A result keeps its
 * cursor open after the first page until the rows run out or the caller closes it (decision 025).
 */
export class ResultStore {
  readonly #results = new Map<ResultHandle, StoredResult>();
  readonly #limits: ResultLimits;
  #nextHandle = 1;

  constructor(limits: Partial<ResultLimits> = {}) {
    this.#limits = { ...DEFAULT_LIMITS, ...limits };
  }

  /** Reads the first page from `result.rows` and keeps the iterator for the next. */
  async put(result: ExecuteResult, limits: Partial<ResultLimits> = {}): Promise<ResultSummary> {
    const { pageRows, fetchAllCap } = { ...this.#limits, ...definedLimits(limits) };
    const stored: StoredResult = {
      columns: result.columns,
      classes: [],
      rows: [],
      iterator: result.rows[Symbol.asyncIterator](),
      lookahead: null,
      complete: false,
      keys: [],
      order: null,
      fetching: Promise.resolve(),
      stopRequested: false,
    };
    try {
      await this.#read(stored, Math.min(pageRows, fetchAllCap), fetchAllCap);
    } catch (cause) {
      await this.#close(stored);
      throw cause;
    }
    stored.classes = result.columns.map((column, index) =>
      column.type === null ? inferredTypeClass(stored.rows.map((row) => row[index] ?? null)) : typeClass(column.type),
    );
    const handle = `${HANDLE_PREFIX}${this.#nextHandle++}`;
    this.#results.set(handle, stored);
    return {
      handle,
      columns: result.columns,
      typeClasses: stored.classes,
      rowsAffected: result.rowsAffected,
      ...stateOf(stored),
    };
  }

  /** Appends a page, or everything up to the cap; a sorted result re-sorts with the new rows. */
  fetchMore(handle: ResultHandle, options: FetchOptions): Promise<ResultState> {
    const stored = this.#stored(handle);
    const fetch = stored.fetching.then(async () => {
      if (stored.iterator === null) return stateOf(stored);
      const { pageRows, fetchAllCap } = { ...this.#limits, ...definedLimits(options) };
      const target = options.all ? fetchAllCap : stored.rows.length + pageRows;
      try {
        await this.#read(stored, Math.min(target, fetchAllCap), fetchAllCap);
      } catch (cause) {
        await this.#close(stored);
        throw cause;
      }
      return stateOf(stored);
    });
    stored.fetching = fetch.catch(() => undefined);
    return fetch;
  }

  /**
   * Ends a running fetch, and any queued before this call, after its current row; the rows read
   * so far stay and the cursor stays open.
   */
  async stopFetch(handle: ResultHandle): Promise<ResultState> {
    const stored = this.#stored(handle);
    stored.stopRequested = true;
    await stored.fetching;
    stored.stopRequested = false;
    return stateOf(stored);
  }

  /** Stops reading for good; the rows already held stay. A no-op once the cursor is closed. */
  async closeCursor(handle: ResultHandle): Promise<ResultState> {
    const stored = this.#stored(handle);
    stored.stopRequested = true;
    await stored.fetching;
    await this.#close(stored);
    return stateOf(stored);
  }

  /** Sorts the held rows locally; an empty `keys` restores the order the statement returned. */
  sort(handle: ResultHandle, keys: readonly SortKey[]): ResultState {
    const stored = this.#stored(handle);
    for (const key of keys) {
      if (!Number.isInteger(key.column) || key.column < 0 || key.column >= stored.columns.length) {
        throw new CoreError(
          "invalidRequest",
          `Sort column ${String(key.column)} is outside this result's ${String(stored.columns.length)} columns.`,
          "Sort by a column the result has.",
        );
      }
    }
    stored.keys = keys;
    stored.order = null;
    return stateOf(stored);
  }

  /** At most `RESULT_WINDOW_ROWS` rows from `offset` in the current sort order. */
  window(handle: ResultHandle, offset: number, limit: number = RESULT_WINDOW_ROWS): ResultWindow {
    const stored = this.#stored(handle);
    const start = Math.max(0, offset);
    const count = Math.max(0, Math.min(limit, RESULT_WINDOW_ROWS));
    if (stored.keys.length === 0) return { offset: start, rows: stored.rows.slice(start, start + count) };
    const order = this.#order(stored).slice(start, start + count);
    return { offset: start, rows: order.map((index) => stored.rows[index] as Row) };
  }

  /** Every held row in the current sort order, for copy and export. */
  rows(handle: ResultHandle): readonly Row[] {
    return this.#ordered(this.#stored(handle));
  }

  columns(handle: ResultHandle): readonly Column[] {
    return this.#stored(handle).columns;
  }

  state(handle: ResultHandle): ResultState {
    return stateOf(this.#stored(handle));
  }

  /**
   * Hands the open cursor to `use` and forgets it, for an export that drains it past the cap.
   * Yields the lookahead row first. The result is complete when `use` resolves.
   */
  async drain<T>(handle: ResultHandle, use: (rows: AsyncIterable<Row>) => Promise<T>): Promise<T> {
    const stored = this.#stored(handle);
    await stored.fetching;
    const { iterator, lookahead } = stored;
    stored.iterator = null;
    stored.lookahead = null;
    if (iterator === null) return use(EMPTY_ROWS);
    async function* rest(): AsyncGenerator<Row, void, undefined> {
      if (lookahead !== null) yield lookahead.row;
      for (;;) {
        const next = await (iterator as AsyncIterator<Row>).next();
        if (next.done === true) return;
        yield next.value;
      }
    }
    const rows = rest();
    try {
      return await use(rows);
    } finally {
      await rows.return(undefined);
      await iterator.return?.();
    }
  }

  /** Closes the cursor and drops the rows. Releasing an unknown handle is a no-op, so a renderer may release twice. */
  async release(handle: ResultHandle): Promise<void> {
    const stored = this.#results.get(handle);
    if (stored === undefined) return;
    this.#results.delete(handle);
    stored.stopRequested = true;
    await stored.fetching;
    await this.#close(stored);
  }

  get size(): number {
    return this.#results.size;
  }

  #stored(handle: ResultHandle): StoredResult {
    const stored = this.#results.get(handle);
    if (stored === undefined) throw unknownHandle(handle);
    return stored;
  }

  #order(stored: StoredResult): readonly number[] {
    stored.order ??= sortedOrder(stored);
    return stored.order;
  }

  #ordered(stored: StoredResult): readonly Row[] {
    if (stored.keys.length === 0) return stored.rows;
    return this.#order(stored).map((index) => stored.rows[index] as Row);
  }

  /** Reads until `target` rows are held, the rows run out, or a stop is requested. */
  async #read(stored: StoredResult, target: number, fetchAllCap: number): Promise<void> {
    const { rows } = stored;
    while (rows.length < target && stored.iterator !== null && !stored.stopRequested) {
      if (stored.lookahead !== null) {
        rows.push(stored.lookahead.row);
        stored.lookahead = null;
        continue;
      }
      const next = await stored.iterator.next();
      if (next.done === true) {
        stored.complete = true;
        stored.iterator = null;
        break;
      }
      rows.push(next.value);
    }
    stored.order = null;
    if (stored.iterator === null || stored.lookahead !== null || stored.stopRequested) return;
    const next = await stored.iterator.next();
    if (next.done === true) {
      stored.complete = true;
      stored.iterator = null;
      return;
    }
    stored.lookahead = { row: next.value };
    if (rows.length >= fetchAllCap) await this.#close(stored);
  }

  async #close(stored: StoredResult): Promise<void> {
    const { iterator } = stored;
    stored.iterator = null;
    stored.lookahead = null;
    await iterator?.return?.();
  }
}

const EMPTY_ROWS: AsyncIterable<Row> = {
  [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }),
};

function sortedOrder(stored: StoredResult): number[] {
  const order = stored.rows.map((_, index) => index);
  const { rows, keys, classes } = stored;
  order.sort((left, right) => {
    for (const key of keys) {
      const a = rows[left]?.[key.column] ?? null;
      const b = rows[right]?.[key.column] ?? null;
      const compared = compareValues(a, b, classes[key.column] ?? "text");
      if (compared !== 0) return key.direction === "asc" ? compared : -compared;
    }
    return left - right;
  });
  return order;
}
