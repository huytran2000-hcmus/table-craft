import { describe, expect, it } from "vitest";
import { history, undo } from "@codemirror/commands";
import { EditorSelection, EditorState, type Transaction } from "@codemirror/state";
import { insertionAt } from "@table-craft/desktop/renderer/console/insertion.js";

/** Applies `undo` the way a view would, answering the state after it. */
function undone(state: EditorState): EditorState {
  let next = state;
  undo({
    state,
    dispatch: (transaction: Transaction) => {
      next = transaction.state;
    },
  });
  return next;
}

describe("inserting into a console", () => {
  it("givenSelection_whenInserting_thenReplacedAndUndoneInOneStep", () => {
    const typed = EditorState.create({ doc: "SELECT 1;\n", extensions: [history()] })
      .update({ changes: { from: 10, insert: "SELECT x" }, userEvent: "input.type" })
      .state.update({ selection: EditorSelection.range(17, 18) }).state;

    const inserted = typed.update(insertionAt(typed, "42")).state;

    expect(inserted.doc.toString()).toBe("SELECT 1;\nSELECT 42");
    expect(inserted.selection.main.head).toBe(19);
    expect(undone(inserted).doc.toString()).toBe("SELECT 1;\nSELECT x");
  });

  it("givenCaret_whenInserting_thenTextAtCaretAndCaretAfter", () => {
    const state = EditorState.create({ doc: "AB", selection: { anchor: 1 } });

    const inserted = state.update(insertionAt(state, "xyz")).state;

    expect(inserted.doc.toString()).toBe("AxyzB");
    expect(inserted.selection.main.head).toBe(4);
  });
});
