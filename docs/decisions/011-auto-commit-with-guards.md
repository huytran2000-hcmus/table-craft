# 011: Auto-commit, with guards

Status: Accepted

## Decision

- Each console starts in auto-commit and can switch to manual. Manual mode shows Commit, Rollback
  and an open-transaction badge; closing a console with an open transaction asks Commit, Rollback
  or Cancel.
- A datasource has a `readOnly` flag, enforced in the session where the driver allows it
  (`SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`, `PRAGMA query_only`) and in the UI, and a
  `color` that tints its tabs and console border.
- Statements the plugin classifies as destructive (`UPDATE` or `DELETE` without `WHERE`, `DROP`,
  `TRUNCATE`) require confirmation before they run. `EXPLAIN ANALYZE` of one of them is destructive
  too, because it runs the statement; a plain `EXPLAIN` is not (decision 031).
- Table editor submits always run as one transaction, whatever the console mode, and roll back
  entirely on error.

## Rationale

Matching DataGrip's defaults keeps muscle memory. Manual-by-default is safer but adds friction to
every local query; the colour, read-only flag and destructive guard put the friction where the
risk is.

## Consequences

- The guard is only as good as the plugin's classification (decision 008); the contract suite
  covers the listed cases for every SQL plugin.
- An engine crash with an open transaction loses it; the database rolls it back.
