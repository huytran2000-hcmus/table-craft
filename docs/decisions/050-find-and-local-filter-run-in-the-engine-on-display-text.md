# 050: Find and the local filter run in the engine, on display text

Status: Proposed. Extends 009 and 025.

## Decision

Find in a result and its local filter are computed by the result store in core
(`packages/core/src/results/view.ts`), beside the local sort, over the rows the engine holds. The
renderer sends one `ViewSpec` per result with `result.view`: the find query (text, Match Case,
Regular Expression, Whole Cell), whether rows without a match are hidden (`rowsOnly`), the filter
chips (equals or excludes a value's database text, Is NULL, Is Not NULL), the searched columns
(the visible ones, in drawing order) and the display formats. The store walks the held rows once,
in sort order, and keeps the shown rows' held indexes and the matched cells; it recomputes lazily
after a fetch or a sort. Windows read through that view and carry their matches as `[row, column]`
pairs; `result.findMatch` steps from a cell and wraps. The renderer sees counts, windows and match
positions, never the rows outside its windows.

A cell matches on its display text: the database's text, as Copy writes it, with digits grouped
when Settings' Group digits is on, which is what the grid draws. A `NULL` cell never matches find;
the Is NULL chip finds it. Both cover the fetched rows only and say so; Search All Rows is Fetch
All, bounded by its cap.

Copy and Select All take the shown rows. Export offers the visible rows, written from memory in the
grid's order, or the whole result through the existing paths.

## Rationale

Decision 009 keeps rows in the engine, and a 100,000-row result is far more than the renderer's
twenty windows; searching only loaded windows would miss matches and could not count them. The
engine already holds every fetched row and the sort permutation, so filtering there costs one pass
and no copying. Measured on the result store: 100,000 rows of 8 text columns, find plus Filter
Rows, 64 to 99 ms per pass on an Apple-silicon laptop (`given100kRowsOf8Columns_…`, budget
1,500 ms); the 10,000-row live test answers within the 120 ms typing settle.

Matching the database's text instead of the drawn text was the alternative: simpler, but `1,234`
on screen would not find `1,234`. The grid's formatter (`renderer/grid/format.ts`) cannot be
imported by the engine across the fence, so core restates the grouping in `displayText` and a
renderer test pins the two to the same output for every type class. The NULL text is left out
because it is a setting about drawing, and `<null>` would otherwise match the text `'<null>'`.

Filtering on the server (the table editor's WHERE bar) stays separate: it is exact and covers rows
not yet fetched, but it re-runs the query and drops the cursor; the local filter is labelled local.

## Consequences

- The table editor's pending edits keep naming held rows; the grid maps a shown row to its held
  row through `ViewState.sources`, so editing under a filter needs no settling first. Plan 026's
  editable console results inherit this mapping.
- Every new view input (a new chip kind, another format) is a `ViewSpec` field mirrored in
  `engine/protocol.ts` and pinned by `test/desktop/protocol.test.ts`.
- No plugin-contract change; `API_VERSION` stays.
- A query over many rows reruns on every keystroke after the settle; past a few hundred thousand
  rows of wide text it would want an incremental or cancellable pass.
