import type { Chord } from "@table-craft/desktop/renderer/actions/chords.js";

/**
 * The chords the SQL editor keeps while it has focus (plan 006 decision 21): the registry lets them
 * through to CodeMirror. `test/renderer/keymap.test.ts` fails when an action that can fire in the
 * editor declares one. Run, Run All and Commit (`Mod+Enter` and its siblings) stay with the registry.
 */
export const EDITOR_CHORDS: readonly Chord[] = ["Mod+Z", "Mod+Shift+Z", "Mod+A", "Mod+F", "Mod+/", "Mod+D", "Escape"];

/**
 * The chords a plain text field keeps (plan 008): the table editor's cell editor and the value
 * panel's text field edit with them, so the grid's Copy or Delete Rows never steals them.
 */
export const FIELD_CHORDS: readonly Chord[] = [
  "Mod+Z",
  "Mod+Shift+Z",
  "Mod+A",
  "Mod+C",
  "Mod+X",
  "Mod+V",
  "Mod+Backspace",
];

const CODE_EDITOR_SELECTOR = ".cm-editor";
const TEXT_INPUT_TYPES: ReadonlySet<string> = new Set(["text", "search", "number", "url", "email", "password"]);

function isTextField(element: Element): boolean {
  if (element instanceof HTMLTextAreaElement) return true;
  return element instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(element.type);
}

/** What the focused control keeps: the editor's chords inside CodeMirror, a field's in an input, else none. */
export function editorReservedChords(): readonly Chord[] {
  const active = document.activeElement;
  if (active === null) return [];
  if (active.closest(CODE_EDITOR_SELECTOR) !== null) return EDITOR_CHORDS;
  return isTextField(active) ? FIELD_CHORDS : [];
}
