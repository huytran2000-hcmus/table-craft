import type { Chord } from "@table-craft/desktop/renderer/actions/chords.js";

/**
 * The chords the SQL editor keeps while it has focus (plan 006 decision 21): the registry lets them
 * through to CodeMirror. `test/renderer/keymap.test.ts` fails when an action that can fire in the
 * editor declares one. Run, Run All and Commit (`Mod+Enter` and its siblings) stay with the registry.
 */
export const EDITOR_CHORDS: readonly Chord[] = ["Mod+Z", "Mod+Shift+Z", "Mod+A", "Mod+F", "Mod+/", "Mod+D", "Escape"];

const CODE_EDITOR_SELECTOR = ".cm-editor";

/** The editor's chords while focus is inside a CodeMirror editor, else none. */
export function editorReservedChords(): readonly Chord[] {
  const active = document.activeElement;
  return active !== null && active.closest(CODE_EDITOR_SELECTOR) !== null ? EDITOR_CHORDS : [];
}
