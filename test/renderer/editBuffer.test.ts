import { describe, expect, it } from "vitest";
import {
  addRow,
  bufferRowAt,
  deleteRows,
  duplicateRows,
  EMPTY_BUFFER,
  gridRowCount,
  inputOf,
  pendingCount,
  pendingInput,
  pendingText,
  revertCells,
  setCell,
  toEdits,
  type EditBuffer,
} from "@table-craft/desktop/renderer/model/editBuffer.js";

const HELD_ROWS = 2;
const COLUMNS = 3;

function edited(): EditBuffer {
  let buffer = setCell(EMPTY_BUFFER, { kind: "held", row: 0 }, 1, { kind: "text", text: "renamed" });
  buffer = setCell(buffer, { kind: "held", row: 0 }, 2, { kind: "null" });
  buffer = setCell(buffer, { kind: "held", row: 1 }, 1, { kind: "default" });
  return buffer;
}

describe("edit buffer", () => {
  it("givenEditBuffer_whenRowsAdded_thenDrawnAfterHeldRows", () => {
    const buffer = addRow(addRow(EMPTY_BUFFER, COLUMNS), COLUMNS);

    expect(gridRowCount(buffer, HELD_ROWS)).toBe(4);
    expect(bufferRowAt(buffer, HELD_ROWS, 1)).toEqual({ kind: "held", row: 1 });
    expect(bufferRowAt(buffer, HELD_ROWS, 3)).toEqual({ kind: "inserted", id: 2 });
    expect(bufferRowAt(buffer, HELD_ROWS, 4)).toBeNull();
    expect(pendingInput(buffer, { kind: "inserted", id: 1 }, 0)).toEqual({ kind: "default" });
  });

  it("givenEditBuffer_whenInsertDeleted_thenInsertDropped", () => {
    const buffer = addRow(EMPTY_BUFFER, COLUMNS);

    const deleted = deleteRows(buffer, [{ kind: "inserted", id: 1 }]);

    expect(deleted.inserts).toEqual([]);
    expect(deleted.deletes.size).toBe(0);
    expect(pendingCount(deleted)).toBe(0);
  });

  it("givenEditedHeldRow_whenDeleted_thenMarkedAndItsEditsDropped", () => {
    const deleted = deleteRows(edited(), [{ kind: "held", row: 0 }]);

    expect([...deleted.deletes]).toEqual([0]);
    expect(deleted.updates.has(0)).toBe(false);
    expect(setCell(deleted, { kind: "held", row: 0 }, 1, { kind: "null" })).toBe(deleted);
    expect(pendingText(pendingCount(deleted))).toBe("2 pending changes");
  });

  it("givenEditBuffer_whenRevertSelected_thenOnlyThoseCellsReverted", () => {
    const buffer = addRow(deleteRows(edited(), []), COLUMNS);

    const reverted = revertCells(buffer, HELD_ROWS, [
      { row: 0, column: 1 },
      { row: 2, column: 0 },
    ]);

    expect(pendingInput(reverted, { kind: "held", row: 0 }, 1)).toBeUndefined();
    expect(pendingInput(reverted, { kind: "held", row: 0 }, 2)).toEqual({ kind: "null" });
    expect(pendingInput(reverted, { kind: "held", row: 1 }, 1)).toEqual({ kind: "default" });
    expect(reverted.inserts).toEqual([]);
  });

  it("givenDeletedRow_whenReverted_thenRowComesBack", () => {
    const buffer = deleteRows(EMPTY_BUFFER, [{ kind: "held", row: 1 }]);

    expect(revertCells(buffer, HELD_ROWS, [{ row: 1, column: 0 }]).deletes.size).toBe(0);
  });

  it("givenDuplicateRow_whenBuffered_thenIdentityColumnsDefault", () => {
    const source = [inputOf(7), inputOf("seven"), inputOf(null)];

    const buffer = duplicateRows(EMPTY_BUFFER, [source], [true, false, false]);

    expect(buffer.inserts[0]?.values).toEqual([{ kind: "default" }, { kind: "text", text: "seven" }, { kind: "null" }]);
  });

  it("givenBytesValue_whenCopied_thenDefaultTaken", () => {
    expect(inputOf({ kind: "bytes", preview: "00ff", length: 2 })).toEqual({ kind: "default" });
  });

  it("givenMixedEdits_whenSent_thenDeletesUpdatesInsertsInOrder", () => {
    const buffer = addRow(deleteRows(edited(), [{ kind: "held", row: 1 }]), COLUMNS);

    expect(toEdits(buffer).map((edit) => edit.kind)).toEqual(["delete", "update", "insert"]);
    expect(toEdits(buffer)[1]).toEqual({
      kind: "update",
      row: 0,
      values: [
        { column: 1, value: { kind: "text", text: "renamed" } },
        { column: 2, value: { kind: "null" } },
      ],
    });
  });
});
