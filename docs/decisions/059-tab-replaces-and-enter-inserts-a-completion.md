# 059: Tab replaces and Enter inserts a completion

Status: Proposed. Amends 028.

## Decision

While the completion popup is open and takes keys, both Tab and Enter accept the selected option,
in every editor that completes (the SQL console and the table editor's WHERE and ORDER BY bars).
They differ as in DataGrip:

- **Enter inserts**: the option replaces the text from the start of the completed word to the
  caret; identifier characters right of the caret stay. `SELECT * FROM cu|stomer_old`, pick
  `customers`: `SELECT * FROM customers|stomer_old`.
- **Tab replaces**: the option also overwrites the rest of the identifier the caret is in, the run
  of word characters (the language's `charCategorizer`) up to the end of the line. The same example
  gives `SELECT * FROM customers|`.

Either accept is one transaction and one undo step, and Tab never also indents. With no popup open
(or inside CodeMirror's `interactionDelay` after it opens) Tab falls through: snippet fields first,
then `indentWithTab` in the console, and the browser's focus move in a one-line bar. Shift-Tab is
unchanged.

The binding lives with completion (`renderer/console/completionKeys.ts`, added by `completion()` in
`completionSource.ts`), at `Prec.highest` beside CodeMirror's own completion keymap. It is editor
local like Enter, so it is not an action in the registry and not in the README's shortcut table.

## Rationale

Users from DataGrip, VS Code and most IDEs press Tab to take a suggestion; the console indented
instead because its keymap ends with `indentWithTab` and `completionKeymap` binds only Enter.
DataGrip's Enter/Tab split lets a user fix a name in place (Tab) without losing the alternative of
keeping a suffix (Enter), and Enter keeps CodeMirror's existing behaviour.

Tab runs CodeMirror's `acceptCompletion` and a transaction filter extends that one transaction with
the deletion of the rest of the word, instead of reimplementing apply: the option's `apply`, the
`pickedCompletion` annotation and multi-cursor handling stay CodeMirror's, and the completion
state's `from` is not public API. A follow-up delete would make two undo steps.

## Consequences

- No setting: `editor.completion.acceptWithTab` was optional and skipped; Tab always accepts.
- A completion with a function `apply` (none today) gets the replace only if it dispatches with
  `userEvent: "input.complete"`.
- With a snippet field active and the popup open, Tab accepts the completion first; the next Tab
  moves to the next field.
