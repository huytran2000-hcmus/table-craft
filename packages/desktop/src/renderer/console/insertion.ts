import { isolateHistory } from "@codemirror/commands";
import type { EditorState, TransactionSpec } from "@codemirror/state";

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
