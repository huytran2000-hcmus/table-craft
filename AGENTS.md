# table-craft - Agent Guidelines

`table-craft` is a desktop database IDE in the spirit of JetBrains DataGrip: connections, a
database explorer, SQL consoles, a result grid and a table data editor. It is a Bun workspace
written in TypeScript, shipped as an Electron app. Databases are reached through datasource
plugins loaded at runtime; PostgreSQL, MySQL and SQLite ship as built-in plugins. Read
`docs/design/specification.md` for the v1 scope and `docs/decisions/` before changing the process
model, the plugin contract, or where data lives.

## Commands

Run from the repository root.

- `bun install`
- `bun run test` - Vitest, unit tests plus the plugin contract suite against SQLite
- `bun run test:db` - the contract suite against PostgreSQL and MySQL in `docker compose`
- `bun run test:smoke` - build the app and drive it under Playwright; needs a display
- `bun run typecheck` - `tsc --noEmit`, every program
- `bun run lint` / `bun run lint:fix` - ESLint, including the architecture fences
- `bun run format:check` / `bun run format` - Prettier
- `bun run desktop` - build and launch the app
- `bun run desktop:package` - electron-builder; macOS is first-class, Windows and Linux best-effort

Bun is the toolchain only. Electron runs Node, so nothing under `packages/*/src` or
`plugins/*/src` may use `Bun.*` APIs, and drivers must be Node-compatible (decision 001).

Nothing in the tree names the version; the root `package.json` is `0.0.0`. A git tag cuts a
release.

## Verify

Run all four before considering a change done: `bun run lint`, `bun run format:check`,
`bun run typecheck`, `bun run test`. Touching a plugin or the contract also means `bun run test:db`.

## Layout

```
packages/plugin-api/       @table-craft/plugin-api: the plugin contract and nothing else.
                           Types, Zod schemas, API_VERSION, capability names, and the
                           contract test suite under `testing/`. Depends only on zod
packages/core/             @table-craft/core: plugin loader, session manager, result-set
                           store, edit batches, history. Knows nothing about Electron
packages/desktop/          @table-craft/desktop, the Electron app
  src/main/                lifecycle, the window, menus, one engine host per datasource
  src/preload/             contextBridge; hands the engine port to the renderer
  src/engine/              the utilityProcess; `protocol.ts` is the only module the
                           engine and renderer share
  src/renderer/            React 19, Zustand, Tailwind v4, CodeMirror 6; a pure view
plugins/<id>/              built-in plugins (@table-craft/plugin-<id>): postgres, mysql,
                           sqlite. Each depends on plugin-api and its driver alone, and
                           ships a `table-craft-plugin.json` beside `src/`
test/                      Vitest suites, `givenX_whenY_thenZ`
docs/design/               specification.md, design-system.md
docs/decisions/            one numbered file per durable decision
docs/plans/                one plan per feature, committed with its Live test section
docs/evidence/NNN/         screenshots from each plan's live test (decision 016)
```

## Conventions

- Three processes (decision 002). Main holds no state and is not in the request path. The
  renderer reaches the engine over a MessagePort, and every capability is a message in
  `engine/protocol.ts`. ESLint forbids the renderer `@table-craft/core`, any plugin, `node:*`,
  `electron`, and the Node globals. That fence is the architecture; do not route around it.
- Built-in plugins load through the same runtime loader as user plugins (decision 005). Never
  import a plugin statically from core or desktop.
- The UI branches on plugin capabilities, never on plugin ids (decision 007).
- SQL knowledge belongs to the plugin (decision 008). The renderer asks the engine for completions
  and statement boundaries; it does not parse SQL itself.
- Result rows stay in the engine; the renderer sees a handle and windows (decision 009).
- Secrets go through `safeStorage` and are never written to `datasources.json` or logs.
- TypeScript strict, ESM, `verbatimModuleSyntax`. No magic literals: hoist them to a named
  module constant. Errors are typed and say what to do next.
- Colours, spacing and fonts come from design tokens (`docs/design/design-system.md`), never
  literals in components.

## Code comments

Default to none. Write one only if a reader would otherwise make a worse decision.

Never restate the code, narrate steps, describe the change (that is the commit message), or leave
banners, commented-out code, or TODOs without a link.

Do explain why, especially why the simpler approach fails; state invariants the types cannot;
cite sources for magic values and workarounds; doc-comment exported API only. Prefer a better name
or a named constant over a comment.

## Documentation

- `docs/decisions/` records durable decisions. Start from `docs/decisions/TEMPLATE.md` when a
  meaningful alternative exists or a future reader would otherwise reopen the choice, and add the
  row to `docs/decisions/README.md`.
- `docs/plans/` holds implementation plans. Start from `docs/plans/TEMPLATE.md`. A plan is done
  when its phases are green and its Live test section, with screenshots in `docs/evidence/NNN/`,
  is filled in (decision 016).
