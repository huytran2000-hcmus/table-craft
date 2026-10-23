# 057: Submit preempts Run in a grid with pending edits

Status: Proposed.

## Decision

`Action.preempts` lists the actions an action runs ahead of when both match a chord. Submit
(`table.submit`) and Apply Value (`table.applyValue`) preempt Run (`console.run`): the keymap
tries preempting actions first, and an action whose `when` is false falls through to the next.
`⌘↵` in a console grid with pending edits submits them; with none, or anywhere else in the console,
it runs. `findClashes` does not report a pair where one preempts the other.

## Rationale

DataGrip uses `⌘↵` for both Run and Submit, and users already have it in their hands from the
table editor. Run is console-wide with no region, so a grid-scoped Submit overlapped it. Ordering
the registry by hand would be invisible and fragile; a declared precedence keeps the clash test
meaningful for every other pair.

## Consequences

- `⌘↵` in a console grid runs the statement unless that result has pending edits or an open cell
  editor.
- A future chord that needs the same sharing declares `preempts` rather than a new region.
