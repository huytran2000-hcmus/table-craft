# 016: Plans and evidence are tracked

Status: Accepted

## Decision

`docs/plans/NNN-*.md` are committed, not ignored. Each plan ends with a "Live test" section: what
was exercised in the running app, against which databases, what broke and how it was fixed.
Screenshots of that run are committed under `docs/evidence/NNN/`, captured by Playwright from the
built app, and referenced from the section.

## Rationale

preman and autoswe ignore plans because they are written by one person and discarded. Here each
plan is implemented by a separate agent session and reviewed by another, so the plan is the
hand-off and the record. Passing tests prove the units; a screenshot of the app proves the
feature, and lets a reviewer see the UI without building it.

## Consequences

- Screenshots are kept small (one window, PNG, no full-screen captures) to limit repository growth.
- A plan that lands without its Live test section is not done.
