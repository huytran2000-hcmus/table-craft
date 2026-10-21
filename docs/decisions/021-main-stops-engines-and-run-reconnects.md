# 021: Main stops engines, and Run reconnects

Status: Accepted

## Decision

Disconnect is a request to main (`engine.disconnect`), not only the renderer closing its ports. Main
posts `engine.shutdown` to the datasource's engine, which closes every session and exits; main kills
it after `SHUTDOWN_GRACE_MS = 3_000` if it has not. The engine also exits on its own when its last
port closes (plan 004, decision 10). Main reports every exit as `engine.exited { datasourceId, code,
clean }`, where `clean` is true when main asked it to stop or it exited with code 0, and false
otherwise.

The renderer marks a clean exit "disconnected" and an unclean one "failed: engine exited". A
console on either keeps its text and its last result; `Run` on it connects again, prompting for a
Never secret if main has none, and then runs. Deleting a datasource stops its engine and clears its
secrets. Saving an edited datasource leaves a running engine alone; the new config applies on the
next connect.

## Rationale

Plan 004 had the engine exit when its last port closed and nothing else. That is enough when one
window holds every port, but it leaves no way to stop an engine whose port a renderer bug leaked,
and it makes Disconnect depend on the renderer closing ports in the right order. A request to main
is one place that can always end the process, and it lets the exit report say whether the stop was
asked for: the exit code alone cannot, because a killed engine and a crashed one both end non-zero.

A console that turns read-only after a disconnect would make the user open a new tab and lose their
place. DataGrip reconnects on the next statement, so table-craft does too. Restarting the engine on
save would close every console session on that datasource without asking; DataGrip applies edits
on the next connect as well.

## Consequences

- `EngineExited` carries `clean`, and the engine protocol has `engine.shutdown` beside `engine.boot`.
- After a disconnect the grid still shows the last result, but its rows lived in the stopped
  engine: scrolling past the loaded window fails until the statement runs again.
- An edited, connected datasource runs on its old config until Disconnect; the dialog does not say
  so yet.
- Plan 005's metadata cache has to be dropped on any `engine.exited`, clean or not, and refilled on
  the next connect.
