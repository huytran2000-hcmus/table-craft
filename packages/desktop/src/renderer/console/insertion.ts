import { isolateHistory } from "@codemirror/commands";
import type { EditorState, TransactionSpec } from "@codemirror/state";
import type { Replacement } from "@table-craft/desktop/renderer/state/consoles.js";

/**
 * Applies a reformat as one undo step (plan 019 decision 2); null when the text it was computed
 * from changed meanwhile, so a late answer never overwrites newer typing.
 */
export function replacementAt(state: EditorState, replacement: Replacement): TransactionSpec | null {
  const { from, to, before, text, selection } = replacement;
  if (to > state.doc.length || state.doc.sliceString(from, to) !== before) return null;
  return {
    changes: { from, to, insert: text },
    selection: { anchor: selection.from, head: selection.to },
    scrollIntoView: true,
    userEvent: "input.format",
    annotations: isolateHistory.of("full"),
  };
}

/**
 * Replaces the main selection with `text`, or inserts it at the caret, leaving the caret after it.
 * Isolated in the undo history so one undo takes back exactly this, even right after typing.
 */
export function insertionAt(state: EditorState, text: string): TransactionSpec {
  const { from, to } = state.selection.main;
  return {
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    scrollIntoView: true,
    userEvent: "input.paste",
    annotations: isolateHistory.of("full"),
  };
}
