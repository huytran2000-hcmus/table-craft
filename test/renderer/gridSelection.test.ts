import { describe, expect, it } from "vitest";
import {
  cellCount,
  clampSelection,
  extendTo,
  moveBy,
  rectOf,
  selectAll,
  selectCell,
  selectColumn,
  selectedRanges,
  selectRows,
} from "@table-craft/desktop/renderer/model/gridSelection.js";

const BOUNDS = { rows: 1_200, columns: 4 };

describe("grid selection", () => {
  it("givenAnchorAndShiftArrow_whenExtended_thenRectangleRanges", () => {
    let selection = selectCell({ row: 10, column: 1 });
    selection = moveBy(selection, 1, 0, BOUNDS, true);
    selection = moveBy(selection, 1, 0, BOUNDS, true);
    selection = moveBy(selection, 0, 1, BOUNDS, true);

    expect(rectOf(selection)).toEqual({ top: 10, bottom: 12, left: 1, right: 2 });
    expect(cellCount(selection)).toBe(6);
    expect(selectedRanges(selection, [0, 2, 3, 5])).toEqual({ rows: [{ from: 10, to: 13 }], columns: [2, 3] });
  });

  it("givenArrowWithoutShift_whenMoved_thenAnchorFollowsFocus", () => {
    const selection = moveBy(extendTo(selectCell({ row: 0, column: 0 }), { row: 3, column: 2 }), 1, 0, BOUNDS, false);

    expect(selection).toEqual(selectCell({ row: 4, column: 2 }));
  });

  it("givenEdgeOfGrid_whenMovedPast_thenClamped", () => {
    expect(moveBy(selectCell({ row: 0, column: 0 }), -5, -5, BOUNDS, false).focus).toEqual({ row: 0, column: 0 });
    expect(moveBy(selectCell({ row: 1_199, column: 3 }), 40, 9, BOUNDS, false).focus).toEqual({
      row: 1_199,
      column: 3,
    });
  });

  it("givenDragUpAndLeft_whenExtended_thenRectNormalised", () => {
    const selection = extendTo(selectCell({ row: 8, column: 3 }), { row: 2, column: 1 });

    expect(rectOf(selection)).toEqual({ top: 2, bottom: 8, left: 1, right: 3 });
  });

  it("givenRowNumberShiftClick_whenSelected_thenWholeRowsFromEarlierRow", () => {
    expect(rectOf(selectRows(7, BOUNDS, 4))).toEqual({ top: 4, bottom: 7, left: 0, right: 3 });
    expect(rectOf(selectRows(7, BOUNDS))).toEqual({ top: 7, bottom: 7, left: 0, right: 3 });
  });

  it("givenHeaderModClick_whenSelected_thenEveryFetchedRowOfColumn", () => {
    expect(rectOf(selectColumn(2, BOUNDS))).toEqual({ top: 0, bottom: 1_199, left: 2, right: 2 });
  });

  it("givenSelectAll_whenRanged_thenEveryFetchedRowAndVisibleColumn", () => {
    expect(selectedRanges(selectAll(BOUNDS), [0, 1, 2, 3])).toEqual({
      rows: [{ from: 0, to: 1_200 }],
      columns: [0, 1, 2, 3],
    });
  });

  it("givenFewerColumnsAfterHide_whenClamped_thenSelectionStaysInside", () => {
    const selection = extendTo(selectCell({ row: 0, column: 1 }), { row: 2, column: 3 });

    expect(rectOf(clampSelection(selection, { rows: 3, columns: 2 }) ?? selectCell({ row: -1, column: -1 }))).toEqual({
      top: 0,
      bottom: 2,
      left: 1,
      right: 1,
    });
    expect(clampSelection(selection, { rows: 0, columns: 2 })).toBeNull();
  });
});
