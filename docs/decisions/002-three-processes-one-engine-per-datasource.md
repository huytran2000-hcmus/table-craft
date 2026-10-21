# 002: Three processes, one engine per datasource

Status: Accepted

## Decision

- **Main** owns the app lifecycle, the window, menus, dialogs, app settings and `safeStorage`. It
  holds no database state and is not in the request path.
- **Engine**: one `utilityProcess` per connected datasource, forked on first connect and stopped on
  disconnect or after an idle timeout. It loads the datasource's plugin and hosts every session for
  it: each console and table editor gets its own database session, the explorer uses a separate
  one.
- **Renderer**: a sandboxed, context-isolated pure view. Main creates a `MessageChannelMain` per
  engine and hands one port to the engine and the other, through preload, to the renderer, which
  then talks to the engine directly.

Every message is typed in `packages/desktop/src/engine/protocol.ts`, the only module the engine and
renderer share. ESLint forbids the renderer `@table-craft/core`, plugins, `node:*`, `electron`, and
the Node globals.

## Rationale

Plugins are trusted code (decision 006), so the process boundary is the only isolation they get.
Per datasource is the unit a user thinks in: a crashed or hung driver costs that connection and
nothing else, while other consoles keep their text and their sessions. One shared engine is
cheapest but lets one bad plugin take everything down; one per plugin type is a middle ground that
still couples unrelated production and local connections.

## Consequences

- About 40 MB per connected datasource. Idle shutdown keeps forgotten connections from accruing.
- An engine exit is a normal event the UI handles: a "disconnected, reconnect" state, unsent edits
  and console text preserved.
- Constants both sides need (window sizes, limits) are duplicated in `protocol.ts` and pinned by a
  test, not imported across the fence.
