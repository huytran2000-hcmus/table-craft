import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/**
 * The SQL editor's look, every value a `--tc-*` variable `appearance/apply.ts` writes from the
 * design tokens (plan 006 decision 2), so the editor follows the theme without a rebuild.
 */

/** The flashed statement's mark; `Editor.tsx` adds and removes it. */
export const FLASH_CLASS = "tc-statement-flash";
const FLASH_FADE = "background-color 600ms ease-out";
const SELECTION_FILL = "color-mix(in oklab, var(--tc-accent) 35%, transparent)";
const SELECTION_MATCH_FILL = "color-mix(in oklab, var(--tc-accent) 15%, transparent)";
const LINE_HEIGHT = "1.5";
const GUTTER_PADDING = "0 8px 0 12px";
const LINE_PADDING = "0 var(--tc-cell-padding)";
const PANEL_PADDING = "4px var(--tc-cell-padding)";

/**
 * CodeMirror's base theme paints the focused band through this five-class selector; a shorter one
 * loses on specificity whatever its precedence, so the band repeats the shape.
 */
const SELECTION_SELECTOR =
  ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground";

export const EDITOR_THEME_SPEC = {
  "&": {
    height: "100%",
    backgroundColor: "var(--tc-canvas)",
    color: "var(--tc-ink)",
    fontSize: "var(--tc-font-editor-size)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--tc-font-editor)", lineHeight: LINE_HEIGHT, overflow: "auto" },
  ".cm-content": { caretColor: "var(--tc-ink)" },
  ".cm-line": { padding: LINE_PADDING },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--tc-ink)" },
  ".cm-gutters": {
    backgroundColor: "var(--tc-panel)",
    color: "var(--tc-ink-muted)",
    borderRight: "1px solid var(--tc-border)",
  },
  ".cm-gutterElement": { padding: GUTTER_PADDING },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--tc-ink)" },
  [SELECTION_SELECTOR]: { backgroundColor: SELECTION_FILL },
  ".cm-selectionMatch": { backgroundColor: SELECTION_MATCH_FILL },
  ".cm-searchMatch": { backgroundColor: "var(--tc-search-match)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: SELECTION_FILL },
  "&.cm-focused .cm-matchingBracket": { backgroundColor: "var(--tc-syntax-bracket-match)", color: "inherit" },
  "&.cm-focused .cm-nonmatchingBracket": { color: "var(--tc-danger)" },
  [`.${FLASH_CLASS}`]: { backgroundColor: "var(--tc-statement-flash)", transition: FLASH_FADE },
  ".cm-panels": { backgroundColor: "var(--tc-panel)", color: "var(--tc-ink)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--tc-border)" },
  ".cm-search": { padding: PANEL_PADDING, fontFamily: "var(--tc-font-ui)", fontSize: "var(--tc-font-ui-size)" },
  ".cm-textfield": {
    backgroundColor: "var(--tc-canvas)",
    border: "1px solid var(--tc-border)",
    borderRadius: "4px",
    color: "var(--tc-ink)",
  },
  ".cm-button": {
    backgroundColor: "var(--tc-raised)",
    backgroundImage: "none",
    border: "1px solid var(--tc-border)",
    borderRadius: "4px",
    color: "var(--tc-ink)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--tc-raised)",
    border: "1px solid var(--tc-border)",
    color: "var(--tc-ink)",
  },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--tc-font-editor)" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--tc-selection)",
    color: "var(--tc-ink)",
  },
};

const HIGHLIGHT_STYLE = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.bool, tags.null], color: "var(--tc-syntax-keyword)" },
  { tag: [tags.typeName, tags.standard(tags.name)], color: "var(--tc-syntax-keyword)" },
  { tag: tags.string, color: "var(--tc-syntax-string)" },
  { tag: tags.number, color: "var(--tc-syntax-number)" },
  { tag: [tags.lineComment, tags.blockComment], color: "var(--tc-syntax-comment)", fontStyle: "italic" },
  // lang-sql tags a quoted identifier `special(string)` and a bind variable `special(name)`.
  { tag: tags.special(tags.string), color: "var(--tc-syntax-identifier)" },
  { tag: [tags.operator, tags.punctuation], color: "var(--tc-syntax-operator)" },
  { tag: tags.special(tags.name), color: "var(--tc-syntax-variable)" },
]);

export const EDITOR_THEME: Extension = [
  EditorView.theme(EDITOR_THEME_SPEC, { dark: true }),
  syntaxHighlighting(HIGHLIGHT_STYLE),
];
