import { describe, expect, it } from "vitest";
import { insertCompletionText } from "@codemirror/autocomplete";
import { history, undo } from "@codemirror/commands";
import { EditorState, type Transaction } from "@codemirror/state";
import {
  replacingRestOfWord,
  restOfWordEnd,
  restOfWordFilter,
} from "@table-craft/desktop/renderer/console/completionKeys.js";

const DOC = "SELECT * FROM customer_old WHERE 1";
const WORD_FROM = DOC.indexOf("cu");
const CARET = WORD_FROM + 2;

function caretIn(doc: string, at: number): EditorState {
  return EditorState.create({ doc, selection: { anchor: at }, extensions: [history(), restOfWordFilter] });
}

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

describe("Tab accepting a completion", () => {
  it("givenCaretInsideIdentifier_whenRestOfWordEnd_thenEndOfIdentifier", () => {
    expect(restOfWordEnd(caretIn(DOC, CARET), CARET)).toBe(DOC.indexOf(" WHERE"));
  });

  it("givenCaretBeforeSpace_whenRestOfWordEnd_thenCaret", () => {
    const end = DOC.indexOf(" WHERE");
    expect(restOfWordEnd(caretIn(DOC, end), end)).toBe(end);
  });

  it("givenCaretInsideIdentifier_whenReplacing_thenWholeIdentifierReplacedInOneUndoStep", () => {
    const state = caretIn(DOC, CARET);

    const accepted = replacingRestOfWord(
      () => state.update(insertCompletionText(state, "customers", WORD_FROM, CARET)).state,
    );

    expect(accepted.doc.toString()).toBe("SELECT * FROM customers WHERE 1");
    expect(accepted.selection.main.head).toBe(WORD_FROM + "customers".length);
    expect(undone(accepted).doc.toString()).toBe(DOC);
  });

  it("givenCaretInsideIdentifier_whenInsertingLikeEnter_thenRestOfIdentifierKept", () => {
    const state = caretIn(DOC, CARET);

    const accepted = state.update(insertCompletionText(state, "customers", WORD_FROM, CARET)).state;

    expect(accepted.doc.toString()).toBe("SELECT * FROM customersstomer_old WHERE 1");
  });

  it("givenOtherInput_whenReplacing_thenUntouched", () => {
    const state = caretIn(DOC, CARET);

    const typed = replacingRestOfWord(() => state.update({ changes: { from: CARET, insert: "x" } }).state);

    expect(typed.doc.toString()).toBe("SELECT * FROM cuxstomer_old WHERE 1");
  });
});
