# 006: Plugins are trusted and run in the engine

Status: Accepted

## Decision

Plugin code runs with full Node access inside the engine process of the datasource that uses it.
There is no sandbox and no permission model. Installing a user plugin requires a one-time
confirmation that it runs code on this machine.

## Rationale

Drivers need raw sockets, TLS, files and sometimes child processes; a permission model would have
to grant nearly everything to be useful. A dedicated plugin-host process adds a hop to every row
streamed. The engine is already one process per datasource (decision 002), so crash isolation
comes free. This is the VS Code extension model, and users understand it.

## Consequences

- A malicious plugin can read anything the user can. The install prompt says so plainly.
- Plugins never run in main or the renderer, so a plugin cannot reach `safeStorage` directly; the
  engine receives the decrypted secret for the one datasource it serves.
- Revisit with a new record if third-party plugins are ever distributed from a public registry.
