# 039: The daily-friction release amends the v1 scope

Status: Accepted

## Decision

Decision 014 lists what v1 ships. The daily-friction release adds these features to it, one plan
each (plans 017 to 026):

| Plan | Feature                                                            |
| ---- | ------------------------------------------------------------------ |
| 017  | App log and diagnostics export (decision 038)                      |
| 018  | Streaming export that survives an unreliable network, and XLSX     |
| 019  | Reformat SQL and query parameters                                  |
| 020  | In-app update, with an Update button in the header when one exists |
| 021  | CSV import                                                         |
| 022  | Completion and resolution follow `USE database`                    |
| 023  | Search and filter in results                                       |
| 024  | Object management from the database tree                           |
| 025  | Statement timeout, connection keepalive and connection URLs        |
| 026  | Editable console results                                           |

Decision 014's **v1.1** and **Later** lists are unchanged.

## Rationale

Decision 014 says features outside its list need the record updated, not just a plan. Ten plans
run in parallel sessions; one amendment that names them all, written by the first plan, keeps the
other sessions from editing the same record and conflicting on merge.

## Consequences

- Each of plans 018 to 026 cites this record for its scope instead of amending decision 014.
- A feature dropped from the release is struck from this table, not from decision 014.
