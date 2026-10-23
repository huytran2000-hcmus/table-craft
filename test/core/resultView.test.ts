import { ResultStore, displayText, findMatcher, type CoreError, type ViewSpec } from "@table-craft/core";
import type { Column, ExecuteResult, Row } from "@table-craft/plugin-api";
import { describe, expect, it } from "vitest";

const COLUMNS: readonly Column[] = [
  { name: "id", type: "INTEGER" },
  { name: "name", type: "TEXT" },
  { name: "note", type: "TEXT" },
];
const ROWS: readonly Row[] = [
  [1, "Alpha", "first"],
  [2, "beta", null],
  [3, "Gamma", "alpha male"],
  [4, "alpha", "x"],
  [1234, "delta", "1,234"],
];
const LARGE_ROWS = 100_000;
const LARGE_BUDGET_MS = 1_500;
const PAGE_ROWS = 2;

function resultFrom(columns: readonly Column[], values: readonly Row[]): ExecuteResult {
  async function* rows(): AsyncGenerator<Row> {
    for (const row of values) yield await Promise.resolve(row);
  }
  return { columns, rows: rows(), rowsAffected: null };
}

function spec(overrides: Partial<ViewSpec> = {}, text = ""): ViewSpec {
  return {
    find: text === "" ? null : { text, caseSensitive: false, regex: false, wholeCell: false },
    rowsOnly: false,
    filters: [],
    columns: [0, 1, 2],
    formats: { groupDigits: false },
    ...overrides,
  };
}

async function stored(rows: readonly Row[] = ROWS): Promise<{ store: ResultStore; handle: string }> {
  const store = new ResultStore();
  const { handle } = await store.put(resultFrom(COLUMNS, rows));
  return { store, handle };
}

describe("result view", () => {
  it("givenFindAlpha_whenWindowRequested_thenMatchesCaseInsensitiveCellsInDrawingOrder", async () => {
    const { store, handle } = await stored();

    const state = store.setView(handle, spec({}, "alpha"));
    const window = store.window(handle, 0);

    expect(state).toMatchObject({ shown: 5, filtered: false, sources: null, matches: 3, error: null });
    expect(window.matches).toEqual([0, 1, 2, 2, 3, 1]);
  });

  it("givenCaseSensitive_whenFound_thenOnlyExactCaseMatches", async () => {
    const { store, handle } = await stored();

    const state = store.setView(handle, {
      ...spec(),
      find: { text: "alpha", caseSensitive: true, regex: false, wholeCell: false },
    });

    expect(state.matches).toBe(2);
  });

  it("givenWholeCell_whenFound_thenPartialCellsDoNotMatch", async () => {
    const { store, handle } = await stored();

    store.setView(handle, { ...spec(), find: { text: "alpha", caseSensitive: false, regex: false, wholeCell: true } });

    expect(store.window(handle, 0).matches).toEqual([0, 1, 3, 1]);
  });

  it("givenRegex_whenFound_thenPatternMatchesAndSpecialsAreLiteralWithoutIt", async () => {
    const { store, handle } = await stored();

    const regex = store.setView(handle, {
      ...spec(),
      find: { text: "^[ab]", caseSensitive: false, regex: true, wholeCell: false },
    });
    const literal = store.setView(handle, spec({}, "^[ab]"));

    expect(regex.matches).toBe(4);
    expect(literal.matches).toBe(0);
  });

  it("givenInvalidRegex_whenViewSet_thenErrorAndNothingHidden", async () => {
    const { store, handle } = await stored();

    const state = store.setView(handle, {
      ...spec({ rowsOnly: true }),
      find: { text: "(", caseSensitive: false, regex: true, wholeCell: false },
    });

    expect(state.error).toBe("Unterminated group");
    expect(state).toMatchObject({ shown: 5, filtered: false, matches: 0 });
  });

  it("givenRowsOnly_whenWindowRequested_thenOnlyMatchingRowsWithShownRowIndexes", async () => {
    const { store, handle } = await stored();

    const state = store.setView(handle, spec({ rowsOnly: true }, "alpha"));
    const window = store.window(handle, 0);

    expect(state).toMatchObject({ shown: 3, filtered: true, sources: [0, 2, 3] });
    expect(window.rows.map((row) => row[0])).toEqual([1, 3, 4]);
    expect(window.matches).toEqual([0, 1, 1, 2, 2, 1]);
  });

  it("givenChips_whenViewSet_thenEqualsExcludesAndNullTestsHideRows", async () => {
    const { store, handle } = await stored();

    const equals = store.setView(handle, spec({ filters: [{ column: 1, op: "equals", text: "alpha" }] }));
    const excluded = store.setView(handle, spec({ filters: [{ column: 2, op: "notEquals", text: "x" }] }));
    const isNull = store.setView(handle, spec({ filters: [{ column: 2, op: "isNull" }] }));
    const notNull = store.setView(handle, spec({ filters: [{ column: 2, op: "isNotNull" }] }));

    expect(equals.sources).toEqual([3]);
    expect(excluded.sources).toEqual([0, 1, 2, 4]);
    expect(isNull.sources).toEqual([1]);
    expect(notNull.sources).toEqual([0, 2, 3, 4]);
  });

  it("givenNullCell_whenFindMatchesNullText_thenNullNeverMatches", async () => {
    const { store, handle } = await stored();

    expect(store.setView(handle, spec({}, "null")).matches).toBe(0);
  });

  it("givenGroupedDigits_whenFound_thenMatchesTheDisplayedNumber", async () => {
    const { store, handle } = await stored();

    const raw = store.setView(handle, spec({ columns: [0] }, "1,234"));
    const grouped = store.setView(handle, spec({ columns: [0], formats: { groupDigits: true } }, "1,234"));

    expect(raw.matches).toBe(0);
    expect(grouped.matches).toBe(1);
  });

  it("givenHiddenColumn_whenFound_thenOnlyDrawnColumnsMatch", async () => {
    const { store, handle } = await stored();

    expect(store.setView(handle, spec({ columns: [1] }, "alpha")).matches).toBe(2);
  });

  it("givenSortedResult_whenFiltered_thenViewFollowsSortOrder", async () => {
    const { store, handle } = await stored();
    store.sort(handle, [{ column: 0, direction: "desc" }]);

    store.setView(handle, spec({ rowsOnly: true }, "alpha"));

    expect(store.window(handle, 0).rows.map((row) => row[0])).toEqual([4, 3, 1]);
    expect(store.shownRows(handle).map((row) => row[0])).toEqual([4, 3, 1]);
    expect(store.rows(handle)).toHaveLength(ROWS.length);
  });

  it("givenSortedResult_whenHeldRowsRead_thenIndexedAsTheWindowsNameThem", async () => {
    const { store, handle } = await stored();
    store.sort(handle, [{ column: 0, direction: "desc" }]);

    expect(store.heldRows(handle).map((row) => row[0])).toEqual([1234, 4, 3, 2, 1]);
    const { sources } = store.setView(handle, spec({ rowsOnly: true }, "alpha"));
    const held = store.heldRows(handle);

    expect((sources ?? []).map((index) => held[index]?.[0])).toEqual([4, 3, 1]);
  });

  it("givenMatches_whenFindMatchStepped_thenWrapsBothWays", async () => {
    const { store, handle } = await stored();
    store.setView(handle, spec({}, "alpha"));

    const first = store.findMatch(handle, null, false);
    const second = store.findMatch(handle, { row: 0, column: 1 }, false);
    const wrapped = store.findMatch(handle, { row: 3, column: 1 }, false);
    const last = store.findMatch(handle, null, true);
    const back = store.findMatch(handle, { row: 0, column: 1 }, true);

    expect(first).toEqual({ index: 0, row: 0, column: 1 });
    expect(second).toEqual({ index: 1, row: 2, column: 2 });
    expect(wrapped).toEqual(first);
    expect(last).toEqual({ index: 2, row: 3, column: 1 });
    expect(back).toEqual(last);
  });

  it("givenViewSet_whenMoreRowsFetched_thenViewCoversThem", async () => {
    const store = new ResultStore({ pageRows: PAGE_ROWS });
    const { handle } = await store.put(resultFrom(COLUMNS, ROWS));
    expect(store.setView(handle, spec({ rowsOnly: true }, "alpha")).shown).toBe(1);

    await store.fetchMore(handle, { all: true });

    expect(store.viewState(handle).shown).toBe(3);
  });

  it("givenNullSpec_whenViewSet_thenEveryRowShown", async () => {
    const { store, handle } = await stored();
    store.setView(handle, spec({ rowsOnly: true }, "alpha"));

    const state = store.setView(handle, null);

    expect(state).toMatchObject({ shown: 5, filtered: false });
    expect(store.window(handle, 0).matches).toBeUndefined();
  });

  it("givenColumnOutsideResult_whenViewSet_thenInvalidRequest", async () => {
    const { store, handle } = await stored();

    expect(() => store.setView(handle, spec({ filters: [{ column: 9, op: "isNull" }] }))).toThrow(
      expect.objectContaining({ code: "invalidRequest" }) as CoreError,
    );
  });

  it("givenDisplayText_whenBytesJsonAndDates_thenMatchesWhatTheGridDraws", () => {
    const formats = { groupDigits: true };

    expect(displayText({ kind: "bytes", preview: "cafe", length: 4 }, "bytes", formats)).toBe("0xcafe…");
    expect(displayText({ kind: "json", text: '{"a":1}' }, "json", formats)).toBe('{"a":1}');
    expect(displayText({ kind: "date", iso: "2026-01-02T03:04:05Z" }, "temporal", formats)).toBe(
      "2026-01-02T03:04:05Z",
    );
    expect(displayText({ kind: "bigint", value: "-12345678901" }, "integer", formats)).toBe("-12,345,678,901");
    expect(displayText("12345", "text", formats)).toBe("12345");
  });

  it("givenRegexSpecials_whenPlainFind_thenEscaped", () => {
    const matcher = findMatcher({ text: "a.b", caseSensitive: false, regex: false, wholeCell: false });

    expect("test" in matcher && matcher.test("a.b")).toBe(true);
    expect("test" in matcher && matcher.test("axb")).toBe(false);
  });

  it("given100kRowsOf8Columns_whenFindAndFilterSet_thenWithinBudget", async () => {
    const columns: Column[] = Array.from({ length: 8 }, (_, index) => ({ name: `c${String(index)}`, type: "TEXT" }));
    const rows: Row[] = Array.from({ length: LARGE_ROWS }, (_, row) =>
      columns.map((_, column) => `row ${String(row)} col ${String(column)} value`),
    );
    const store = new ResultStore({ pageRows: LARGE_ROWS, fetchAllCap: LARGE_ROWS });
    const { handle } = await store.put(resultFrom(columns, rows));
    const all = columns.map((_, index) => index);

    const started = performance.now();
    const state = store.setView(handle, spec({ columns: all, rowsOnly: true }, "99 col 3"));
    store.window(handle, 0);
    const elapsed = performance.now() - started;

    expect(state.shown).toBe(1_000);
    expect(elapsed).toBeLessThan(LARGE_BUDGET_MS);
  });
});
