import { RESULT_WINDOW_ROWS, ResultStore, type CoreError } from "@table-craft/core";
import type { ExecuteResult, Row } from "@table-craft/plugin-api";
import { describe, expect, it } from "vitest";

const ROW_COUNT = 1_200;
const WINDOW_OFFSET = 1_000;
const SMALL_FETCH_CAP = 10;

function resultOf(count: number, onReturn?: () => void): ExecuteResult {
  async function* rows(): AsyncGenerator<Row> {
    try {
      for (let index = 0; index < count; index++) yield await Promise.resolve([index]);
    } finally {
      onReturn?.();
    }
  }
  return { columns: [{ name: "n", type: "INTEGER" }], rows: rows(), rowsAffected: null };
}

describe("ResultStore", () => {
  it("givenResultOf1200Rows_whenWindowRequestedAt1000_thenReturns200Rows", async () => {
    const store = new ResultStore();
    const { handle, rowCount } = await store.put(resultOf(ROW_COUNT));

    const window = store.window(handle, WINDOW_OFFSET);

    expect(rowCount).toBe(ROW_COUNT);
    expect(window.rows).toHaveLength(ROW_COUNT - WINDOW_OFFSET);
    expect(window.rows[0]).toEqual([WINDOW_OFFSET]);
  });

  it("givenReleasedHandle_whenWindowRequested_thenUnknownHandleError", async () => {
    const store = new ResultStore();
    const { handle } = await store.put(resultOf(1));
    store.release(handle);

    expect(() => store.window(handle, 0)).toThrow(expect.objectContaining({ code: "unknownHandle" }) as CoreError);
  });

  it("givenLimitAboveWindowSize_whenWindowRequested_thenClampedToWindowSize", async () => {
    const store = new ResultStore();
    const { handle } = await store.put(resultOf(ROW_COUNT));

    expect(store.window(handle, 0, ROW_COUNT).rows).toHaveLength(RESULT_WINDOW_ROWS);
  });

  it("givenMoreRowsThanFetchCap_whenPut_thenTruncatedAndIteratorStopped", async () => {
    let returned = false;
    const store = new ResultStore(SMALL_FETCH_CAP);

    const summary = await store.put(
      resultOf(ROW_COUNT, () => {
        returned = true;
      }),
    );

    expect(summary).toMatchObject({ rowCount: SMALL_FETCH_CAP, truncated: true });
    expect(returned).toBe(true);
  });
});
