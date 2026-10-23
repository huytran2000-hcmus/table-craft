# 058: A closing result holds the session

Status: Proposed. Amends 025 and 054.

## Decision

Closing a result is part of the session's queue. The engine records each close it starts on a
session (`result.release`, the next statement, a commit, a table reload) as that session's closing
promise, and every request that uses the session (a statement, an explain, a transaction call, a
submit, a table query) waits for it first, only when there is one. The wait is bounded by
`CURSOR_CLOSE_GRACE_MS`, 5 seconds; past it the engine drops the session and reconnects, the answer
carries `reconnected.reason: "resultNotClosed"` and Output says "The previous result could not be
closed in time; reconnected." With a transaction open the request fails `transactionLost`
instead. Cancel while a request waits cancels that request before it reaches the plugin.

`sessionBusy` (plugin API 0.16.0) is the plugin's code for a session that an earlier result still
holds. The engine treats it as its own bug: it logs an error with the session's state, drops the
session and runs the request once on a fresh one (`reason: "sessionBusy"`), or fails
`transactionLost` when a transaction was open. A user never sees the plugin's busy text.

The MySQL plugin reads `CONNECTION_ID()` and `VERSION()` as it connects and picks how to stop a
statement from another connection: `KILL QUERY id` on MySQL, `KILL TIDB QUERY id` on TiDB 6.1 and
later, nothing on TiDB before 6.1. An abandoned result is killed where that is safe and otherwise
read to the end and discarded; either way, past 10 seconds the plugin drops the connection, so the
next statement reports it lost. Cancel where no kill is safe drops the connection and rejects
`cancelled` saying the session was reset. A `cancelled` error whose message is not the plain
`STATEMENT_CANCELLED_MESSAGE` reaches Output as "Cancelled: <message>", so the reset is visible.

## Rationale

`result.release` closed the cursor without waiting, so Run right after an unfinished result
reached the plugin while the close was still reading. Both the PostgreSQL and MySQL plugins
answered "Another statement is still running in this session." The text protocol cannot stop a
result but by reading it to the end, and on TiDB 4 `KILL QUERY` returns OK with a warning and
does nothing, so the close took as long as the whole remaining result.

Ordering in the engine fixes every caller at once; making each renderer path await the release
would leave the next caller (export, table editor, a future one) to repeat the race. The grace
keeps "never wait forever": a close that hangs on a dead link costs one reconnect, not a stuck
console.

Before TiDB 6.1 a connection id is unique to one TiDB server only. The kill connection may land on
another server behind the load balancer, where the same id is someone else's session, so a kill
there can stop an unrelated statement. Global Kill (6.1, on by default) makes ids cluster-wide.
Dropping the connection is the only safe stop. ProxySQL and other pools in front of MySQL carry the
same hazard, as their connection ids are not the backend's; the plugin reads `CONNECTION_ID()`
rather than the handshake id, but does not detect a proxy, which stays out of scope.

## Consequences

- Run, Rerun and a table reload after an unfinished result just work, at most 5 seconds late.
- On TiDB before 6.1, Cancel loses session state and any open transaction; the next statement
  reconnects. Abandoning a large result there reads it to the end, up to 10 seconds.
- Plugins report a busy session with `sessionBusy`, not `statementFailed`; third-party plugins
  need API 0.16.0.
- `test:db` runs a TiDB 4 container (`TABLE_CRAFT_TIDB_PORT`, default 54000) and checks that no
  kill is ever sent to it.
