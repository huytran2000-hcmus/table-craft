# 027: Actions scope to a tab kind, and chords clash only where they overlap

Status: Accepted

## Decision

- An action may declare `tabKind` (`console` or `table`); it is enabled only while the active editor
  tab is of that kind. `shortcutRegion` stays a focus region or a list of them.
- The focus regions gain `tableEditor` (the table data editor around its grid) and `valuePanel`
  (the value panel beside a grid).
- `findClashes` reports two actions bound to the same chord only when they can both fire: their tab
  kinds are equal or either is unset, and their regions overlap or either is unset. So ⌘↵ is Run in
  a console, Submit in a table editor and Apply Value in the value panel; ⌘N is New Data Source in
  the Database tool window and Add Row in a table editor.
- Inside a plain text field (`<input>` of a text type, `<textarea>`) the field's own editing chords
  (⌘Z, ⇧⌘Z, ⌘A, ⌘C, ⌘X, ⌘V, ⌘⌫) are reserved for it, as `EDITOR_CHORDS` already are inside
  CodeMirror.

## Rationale

Decision 015 made every command an action with one keymap and a clash test that treated any shared
chord as a clash. DataGrip reuses chords by context: ⌘↵ executes in a console and submits in the
data editor, ⌘D duplicates a datasource in the tree and a row in the grid. Keeping one global chord
per action would have forced invented chords for the data editor, against the inventory. Scoping by
region alone is not enough, because the console grid and the table grid are the same `grid`
region; the tab kind tells them apart. Making the clash test region- and tab-aware keeps it
meaningful: an overlap that could fire both actions is still caught.

## Consequences

- A new chord must be checked against the actions it could fire beside; `test/renderer/keymap.test.ts`
  runs the overlap-aware `findClashes` over every action.
- An action without `tabKind` or `shortcutRegion` overlaps everything, so global chords stay unique.
- The value panel is a region of its own, outside `grid`, so ⌘C and ⌘A there stay native (plan 007).
