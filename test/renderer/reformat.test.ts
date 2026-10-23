import { EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { describe, expect, it } from "vitest";
import { replacementAt } from "@table-craft/desktop/renderer/console/insertion.js";
import { caretAfterReformat } from "@table-craft/desktop/renderer/model/reformat.js";
import type { Replacement } from "@table-craft/desktop/renderer/state/consoles.js";

const BEFORE = "select a,b from t where c=1";
const AFTER = "SELECT\n  a,\n  b\nFROM\n  t\nWHERE\n  c = 1";

function replacement(overrides: Partial<Replacement> = {}): Replacement {
  return {
    from: 0,
    to: BEFORE.length,
    before: BEFORE,
    text: AFTER,
    selection: { from: 0, to: 0 },
    seq: 1,
    ...overrides,
  };
}

describe("caret after reformat", () => {
  it("givenCaretOnToken_whenReformatted_thenCaretStaysOnToken", () => {
    const caret = BEFORE.indexOf("from") + 2;

    const moved = caretAfterReformat(BEFORE, AFTER, caret);

    expect(AFTER.slice(moved - 2, moved + 2)).toBe("FROM");
  });

  it("givenCaretInWhitespace_whenReformatted_thenBeforeTheNextToken", () => {
    const moved = caretAfterReformat(BEFORE, AFTER, BEFORE.indexOf(" where") + 1);

    expect(AFTER.slice(moved)).toMatch(/^WHERE/);
  });

  it("givenCaretAtStartOrEnd_whenReformatted_thenAtStartOrEnd", () => {
    expect(caretAfterReformat(BEFORE, AFTER, 0)).toBe(0);
    expect(caretAfterReformat(BEFORE, AFTER, BEFORE.length)).toBe(AFTER.length);
  });
});

describe("replacement transaction", () => {
  it("givenSelection_whenReformatted_thenOnlySelectionReplaced", () => {
    const doc = `SELECT 1;\n${BEFORE};`;
    const from = doc.indexOf(BEFORE);
    const state = EditorState.create({ doc });

    const spec = replacementAt(state, replacement({ from, to: from + BEFORE.length }));
    const next = spec === null ? state : state.update(spec).state;

    expect(next.doc.toString()).toBe(`SELECT 1;\n${AFTER};`);
  });

  it("givenReformatAfterTyping_whenUndone_thenOneUndoRestoresTheText", () => {
    let state = EditorState.create({ doc: "", extensions: [history()] });
    state = state.update({ changes: { from: 0, insert: BEFORE }, userEvent: "input.type" }).state;
    const spec = replacementAt(state, replacement());
    if (spec === null) throw new Error("the replacement should apply");
    state = state.update(spec).state;

    let undone = state;
    undo({ state, dispatch: (transaction) => (undone = transaction.state) });

    expect(state.doc.toString()).toBe(AFTER);
    expect(undone.doc.toString()).toBe(BEFORE);
  });

  it("givenTextChangedSinceAsked_whenApplied_thenSkipped", () => {
    const state = EditorState.create({ doc: `${BEFORE} -- typed meanwhile` });

    expect(replacementAt(state, replacement({ to: BEFORE.length + 3 }))).toBeNull();
  });
});
