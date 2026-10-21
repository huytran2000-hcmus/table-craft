# Plan: Run SELECT 1 through every layer

Status: done. `bun run desktop` opens a window that runs `SELECT 1 AS one, 'two' AS two` against
in-memory SQLite and draws `one | two` / `1 | two`; `bun run test:smoke` proves it under Playwright.
Reality differed in where things live and in how much protocol a working spine needs: built-in
plugins moved to `plugins/<id>/`, a fifth Vite build produces them, the engine grew two parent-port
messages and an Electron-free router, and the error codes and tests went past the sketch.

## The issue

The repository holds decisions and config, and no code. Before any feature, one thin path has to
cross every boundary the decisions draw, so each later plan extends a working spine instead of
inventing one: a window opens, main forks an engine for a datasource, the engine discovers the
SQLite plugin through the runtime loader, the renderer sends a statement over its own MessagePort,
and the rows come back as a result handle and a window that a virtualized grid draws.

The driving case is an in-memory SQLite datasource running `SELECT 1 AS one, 'two' AS two`.

## Decisions

| #   | Decision                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | SQLite only. Postgres and MySQL arrive in plan 002 with `test:db`; they would add Docker to the first green run for no extra coverage of the boundaries |
| 2   | The datasource is hard-wired in main for this plan; no connection form, no `datasources.json`                                                           |
| 3   | The SQLite plugin is built into `packages/desktop/dist/resources/plugins/sqlite/` and found by the loader like any user plugin (decision 005)           |
| 4   | `API_VERSION` starts at `0.1.0`; the contract is unstable until v1 and says so                                                                          |
| 5   | The grid is a plain virtualized table with no editing, sorting or copy; enough to prove windowing                                                       |
| 6   | No theming beyond the Dark token set, applied through `apply.ts` so plan 00x extends it rather than retrofits it                                        |

### Consequences worth naming

**This sets the plugin contract's first shape.** `DatasourcePlugin`, `PluginManifest`,
`Capability`, `Session.execute` and the wire value type land now. Plan 002 will widen them; that is
expected while `API_VERSION` is `0.x`.

**This sets the protocol's first messages.** `session.open`, `statement.execute`, `result.window`,
`result.release`, `engine.error`.

---

## Phase 0 — plugin-api

| File                                  | Responsibility                                                           |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `packages/plugin-api/src/manifest.ts` | `PluginManifest` Zod schema, `MANIFEST_FILE = "table-craft-plugin.json"` |
| `packages/plugin-api/src/plugin.ts`   | `DatasourcePlugin`, `Session`, `Capability`, `ExecuteResult` types       |
| `packages/plugin-api/src/values.ts`   | the tagged wire value union (decision 009)                               |
| `packages/plugin-api/src/version.ts`  | `API_VERSION`, `isCompatible(apiVersion)`                                |

```ts
export interface DatasourcePlugin {
  readonly id: string;
  readonly capabilities: readonly Capability[];
  readonly connectionSchema: z.ZodType;
  connect(config: unknown): Promise<Session>;
}
```

## Phase 1 — plugin-sqlite and the loader

- `packages/plugin-sqlite`: manifest plus entry on `node:sqlite`, implementing `connect` and
  `execute` returning columns and a row iterator.
- `packages/core/src/plugins/loader.ts`: discover roots, validate manifests, check
  `isCompatible`, `import()` the entry. Failures are values with a reason, not throws.
- `packages/core/src/results/store.ts`: hold rows by handle, serve windows by offset.

## Phase 2 — desktop spine

- Vite configs per process (`vite.{main,preload,engine,renderer}.config.ts`, `vite.shared.ts`),
  copied from preman and renamed.
- `main/hosts.ts`: fork the engine `utilityProcess`, create the `MessageChannelMain`, hand ports.
- `engine/protocol.ts`: the first messages; `engine/main.ts` routes them to core.
- `preload`: expose the engine port to the renderer.
- `renderer`: a console textarea (CodeMirror arrives in its own plan), a Run button, and the grid
  reading windows from a Zustand result store.
- Renderer `tsconfig.json` with DOM, added to `bun run typecheck`.

## Phase 3 — Fixtures, tests, docs

New `test/plugin-api/manifest.test.ts`, `test/core/loader.test.ts`, `test/core/results.test.ts`,
`test/plugins/sqlite.test.ts`, and the first `runPluginContract` cases.

New cases:

`givenValidManifest_whenParsed_thenReturnsManifest`,
`givenManifestWithIncompatibleApiVersion_whenLoaded_thenPluginUnavailableWithReason`,
`givenDuplicatePluginId_whenLoaded_thenErrorNamesBothPaths`,
`givenEntryThatThrowsOnImport_whenLoaded_thenOtherPluginsStillLoad`,
`givenSqliteSession_whenSelectOne_thenReturnsColumnsAndOneRow`,
`givenResultOf1200Rows_whenWindowRequestedAt1000_thenReturns200Rows`,
`givenReleasedHandle_whenWindowRequested_thenUnknownHandleError`,
`givenProtocolConstants_whenComparedWithCore_thenEqual`.

Playwright smoke: launch the built app, run the statement, see `one | two` and `1 | two`.

Docs: `docs/design/specification.md` gains the protocol message list.

Every phase ends with `bun run typecheck` and `bun run test` both green.

---

## Deviations taken while implementing

**1. Built-in plugins live in `plugins/<id>/`, not `packages/plugin-<id>/`.** Asked for during the
work. It ends the `packages/plugin-*` glob overlap with `plugin-api`, mirrors
`resources/plugins/<id>/`, and makes "a plugin depends on plugin-api alone" a directory fact.
Package names stay `@table-craft/plugin-<id>`; workspaces, tsconfig, ESLint fences and `AGENTS.md`
follow. Decision 3's output path is unchanged.

**2. A fifth Vite build, `vite.plugins.config.ts`, produces the built-in plugins.** It bundles each
`plugins/<id>/src/index.ts` to `dist/resources/plugins/<id>/index.js` and copies the manifest beside
it. Code splitting is off: a chunk shared by two plugins would sit outside both directories, and the
loader refuses an entry that reaches out of its own. Each plugin carries its own plugin-api and zod.
The config restates `MANIFEST_FILE` because a Vite config loads in plain Node and cannot import the
TypeScript source; `test/desktop/protocol.test.ts` pins it.

**3. `node:*` is external by scheme, not only by `builtinModules`.** `builtinModules` omits
scheme-only modules such as `node:sqlite`, and Vite silently replaced it with an empty browser shim.

**4. The manifest has a `name`, and plugin-api re-exports `z`.** Decision 005 wants a plugin listed
without executing it, which needs a display name. Re-exporting `z` lets a plugin build its
`connectionSchema` without picking its own zod. `@table-craft/plugin-api/testing` imports vitest, so
plugin-api declares it as an optional peer dependency.

**5. The engine gets two parent-port messages: `engine.boot` and `engine.port`.** The datasource and
plugin roots arrive in `engine.boot`, not argv, because plan 002 puts a decrypted secret in that
config (decision 006). The renderer asks for its port (`table-craft:connect-engine`) instead of main
pushing one on load, so a reload or a slow first paint cannot lose it.

**6. Sessions and result handles belong to the port that created them.** A handle from another port
is `unknownHandle`, and closing a port closes its sessions and releases its results, so a reloaded
window cannot leak or read another's rows.

**7. `engine/main.ts` only wires the parent port; routing is `engine/engine.ts`.** The router is
Electron-free and tested directly in `test/desktop/engine.test.ts`. `engine/requests.ts` parses
every request with zod before routing, since the renderer is untrusted input.

**8. More error codes than the sketch.** Besides core's `unknownHandle`, `unknownPlugin`,
`pluginUnavailable` and `invalidConfig`, the engine raises `unknownSession`, `statementFailed`,
`invalidRequest` and `internal`. A type test pins core's codes as a subset.

**9. More tests than listed; the smoke is gated.** Added `test/plugin-api/version.test.ts`,
`values.test.ts`, `test/desktop/protocol.test.ts` (constants and type-level pins of the restated wire
types) and `test/desktop/engine.test.ts`. The Playwright smoke is `test/e2e/desktop.smoke.test.ts`,
skipped unless `TABLE_CRAFT_SMOKE=1`; `bun run test:smoke` builds and runs it. It needs a display and
a build, so it stays out of `bun run test`. Tests import the SQLite plugin through a
`@table-craft/plugin-sqlite` alias; the loader tests write throwaway plugins to temp directories.

**10. Main sets the app name and `userData` explicitly.** Electron reads the name from the
`package.json` beside the entry, and `dist/main` has none, so `userData` (and the user plugin root)
was `Application Support/Electron`.

**11. Appearance tokens cover fonts and density, not only colours.** Still the Dark set alone, but
the grid font, row height, padding, column width and console height are tokens written by
`apply.ts`, so no component holds a size literal. `docs/design/design-system.md` stays a stub until
the appearance plan lists the tokens it keeps.

**12. Known rough edges.** ESLint reports one warning, `react-hooks/incompatible-library` on
`useVirtualizer`; it is informational, since the build does not run the React Compiler. Electron
43.8 has no postinstall and downloads its binary on the first launch. `electron-builder.yml` exists
but packaging is untested, as scoped.

---

## Out of scope

- Connection management, secrets and the explorer: plan 002 onward.
- CodeMirror, autocomplete and statement splitting: they need the plugin language messages
  (decision 008), their own plan.
- Packaging and signing: the skeleton runs from `bun run desktop`.
