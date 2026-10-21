# 009: Result sets stay in the engine

Status: Accepted

## Decision

Executing a statement returns a result handle, column metadata and the first window of rows. The
grid requests further windows by offset as it scrolls. Fetching from the database is paged too:
the engine pulls rows on demand up to a configurable cap, and the grid shows "N rows fetched, more
available". Sorting and filtering an already-fetched set, copy and export all happen in the engine.
Handles are released when the tab closes or the query is re-run.

## Rationale

This is preman's decision 013 applied to rows instead of response bodies. Structured-cloning a
million rows into the renderer freezes the UI and doubles memory. The grid only ever draws what is
visible, so it only needs what is visible.

## Consequences

- Window size and fetch cap are protocol constants, duplicated and pinned by test (decision 002).
- Export streams from the engine to a file chosen through main's save dialog; rows never pass
  through the renderer.
- Values are serialised to a tagged wire form (`null`, number, bigint as string, bytes as
  preview plus length, JSON, date) defined in plugin-api.
