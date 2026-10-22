# Plan: Package the app, prove the installer works, and close v1's smoke gaps

Status: done. `bun run desktop:package` builds the installer for the host (DMG per architecture on
macOS, NSIS on Windows, AppImage on Linux) and `desktop:package:dir` the unpacked app. The archive
holds only the built bundles and a generated `package.json`; the three built-in plugins ship beside
it in `<resources>/plugins/`, the engine forks straight from `app.asar`, and `main/paths.ts`
resolves every location for a development run and a packaged one. The version comes from git
(`X.Y.Z` on a lone `vX.Y.Z` tag, `0.0.0-dev.<sha>` otherwise); builds without a Developer ID are
signed ad hoc with the hardened runtime off, because ad-hoc library validation refuses Electron's
own framework. The app has an icon, the macOS About panel names the version, and Windows and Linux
gain Help → About table-craft. `test/e2e/workflows.ts` chains the daily loop (connect to Explain
Plan, fifteen steps) and runs it on SQLite, PostgreSQL and MySQL in the dev build and on SQLite in
the packaged one, which also checks its plugins, version, bundled drivers and a setting surviving a
relaunch. The four loose ends are closed: completion acceptance waits for CodeMirror instead of a
sleep, Services recounts rows after Fetch All, a console waiting on a confirmation says so, and a
failed table submit is in Query History. CI runs `verify` and the packaged suite on macOS arm64 and
x64, Windows and Linux on every push, and drafts a release on a `v*` tag. The coverage check added
TSV export, generated CREATE and DROP, and Revert Selected and Revert All, and the DROP scenario
found a SQLite bug (deviation 11).

## The issue

Nobody has ever built an installer. `packages/desktop/electron-builder.yml:1-2` still says
"Packaging is untested until its own plan", and the file is 18 lines: no targets, no icon, no
Windows or Linux block, and `files: dist/**` would put the built-in plugins inside `app.asar`,
where they have never been loaded. Main finds the engine, preload, renderer and plugin root
relative to `import.meta.dirname` (`main/main.ts:68-70`, `:108-109`) and never asks
`app.isPackaged`; `utilityProcess.fork` (`main.ts:115`) and the plugin loader's `import()`
(`core/src/plugins/loader.ts:133`) have only ever run from a plain directory. The desktop package
lists `@table-craft/core` and `@table-craft/plugin-api` as runtime `dependencies`
(`packages/desktop/package.json:8-11`) although Vite inlines them, so electron-builder would try to
collect `workspace:*` packages into the installer.

Decision 014 promises macOS arm64 and x64 first-class, and Windows NSIS and Linux AppImage "built
in CI". There is no CI (`.github/` does not exist). Decision 013 promises "a Playwright smoke test
drives the packaged app"; the harness only ever launches `dist/main/main.js` through the `electron`
package's binary (`test/e2e/harness.ts:24`, `:117-119`, `:134-135`). The version is `0.0.0`
everywhere and AGENTS.md says "a git tag cuts a release", but nothing reads a tag.

The smoke suites cover each feature on its own, but no scenario chains the daily loop, and a few
loose ends from plans 011–013 remain: a completion scenario that flakes on a fixed 150 ms sleep
(`test/e2e/completion.smoke.test.ts:58`, `:154-156`, `:296-315`), five suites that close the app
with a bare `app.close()` and no deadline (`desktop`, `shell`, `shell.databases`, `datasources`,
`explorer`), Services showing the first page's row count after Fetch All (plan 013 deviation 13),
Services and the console showing `Running…` while a confirm dialog waits (plan 012), and a failed
table submit missing from history (plan 011).

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Layout (decision 033).** `app.asar` holds `dist/main`, `dist/engine`, `dist/preload`, `dist/renderer` and a generated `package.json`. Built-in plugins ship via `extraResources` from `dist/resources/plugins` to `<resources>/plugins/<id>/` (`index.js` + `table-craft-plugin.json`). `*.map` files are excluded everywhere. No `node_modules` directory ships.                                                                                                                                                                                                                                                                |
| 2   | **One path module.** New `main/paths.ts` exports `appPaths({ isPackaged, resourcesPath, distDirectory })` returning `{ engineEntry, preload, rendererIndex, builtInPlugins }`; `main.ts` calls it once and stops computing paths itself. Packaged: plugins at `join(resourcesPath, "plugins")`, the rest under `app.asar/dist`. Unit-tested with both inputs.                                                                                                                                                                                                                                                                      |
| 3   | **The engine forks from inside asar** if Electron allows it; the implementer verifies on the packaged app. If `utilityProcess.fork` or the engine's ESM imports fail there, `asarUnpack: dist/engine/**` and the path module points at `app.asar.unpacked` — recorded as a deviation, not a silent fallback.                                                                                                                                                                                                                                                                                                                       |
| 4   | **Runtime dependencies are empty.** `@table-craft/core` and `@table-craft/plugin-api` move to `devDependencies` of `@table-craft/desktop`; a test asserts the packaged `app.asar` contains no `node_modules`.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 5   | **Targets.** macOS: `dmg` for `arm64` and `x64`, separately (no universal). Windows: `nsis` x64. Linux: `AppImage` x64. `bun run desktop:package` builds the host's own platform and architecture; `bun run desktop:package:dir` builds the unpacked app (`--dir`) for the smoke suite, which is faster and launches the same bundle the installer contains.                                                                                                                                                                                                                                                                       |
| 6   | **Signing.** macOS builds are ad-hoc signed (`identity: "-"` or electron-builder's equivalent; verify that an arm64 build launches). `hardenedRuntime` and an entitlements file with only what Electron's V8 needs (`allow-jit`, `allow-unsigned-executable-memory`) are committed, so Developer ID signing and notarisation work when `CSC_LINK`/`APPLE_*` are present; nothing here supplies them and nothing tests them.                                                                                                                                                                                                        |
| 7   | **Icon.** One source `packages/desktop/build/icon.svg` drawn from the Dark theme's tokens (a grid glyph on `canvas` with `accent`), rendered once to `build/icon.png` 1024×1024 by `packages/desktop/scripts/render-icon.ts` (Playwright's Chromium, already a dev dependency); both committed. electron-builder derives `.icns`/`.ico` from the PNG. The running app's window and dock use the same icon.                                                                                                                                                                                                                         |
| 8   | **Version from git.** `packages/desktop/scripts/version.ts` prints `X.Y.Z` when `HEAD` carries exactly one `vX.Y.Z` tag, else `0.0.0-dev.<7-char sha>`; the package scripts pass it as `-c.extraMetadata.version`. `package.json` files stay `0.0.0`. If NSIS rejects the prerelease form, Windows uses `-c.buildVersion` with the numeric part — a deviation if needed.                                                                                                                                                                                                                                                           |
| 9   | **About.** `app.setAboutPanelOptions({ applicationName, applicationVersion: app.getVersion() })`; macOS's app menu already has About. Windows/Linux get Help → About table-craft, an action `app.about` (no chord) showing a notice dialog with the name, version, Electron and Chromium versions. In development the version is `0.0.0`.                                                                                                                                                                                                                                                                                          |
| 10  | **Harness drives an executable.** `launchApp` gains `LaunchOptions.executable?: string`; when set it launches that binary with no entry argument (still `--use-mock-keychain` on macOS). `TABLE_CRAFT_APP_EXECUTABLE` sets it for a whole run. Profiles, `TABLE_CRAFT_USER_DATA` and `TABLE_CRAFT_DATASOURCE` behave the same in a packaged app; those seams stay (decision 018), documented as test seams.                                                                                                                                                                                                                        |
| 11  | **One shared close.** `closeApp(app)` in the harness: `app.close()` within `CLOSE_DEADLINE_MS = 10_000`, then `SIGKILL` of the app's process; every suite's `afterEach` uses it, and the per-suite copies are deleted.                                                                                                                                                                                                                                                                                                                                                                                                             |
| 12  | **The daily loop is one function.** `test/e2e/workflows.ts` exports `dailyLoop(page, target)` that chains DataGrip workflows 1–11, 14–18 (`docs/design/datagrip-inventory.md`, section 11): connect, browse, open table (F4), filter and sort, edit and submit, insert and delete, new console, run, Search Everywhere to a table, export CSV, DDL, SQL Generator, follow an FK, Query History restore, Explain Plan. It asserts state after each step.                                                                                                                                                                            |
| 13  | **Two suites run it.** `test/e2e/workflows.smoke.test.ts` (dev build) runs `dailyLoop` on SQLite under `SMOKE_ENABLED`, and on PostgreSQL and MySQL under `DATABASES_ENABLED`. `test/e2e/packaged.smoke.test.ts` runs only when `TABLE_CRAFT_APP_EXECUTABLE` is set: the plugin check (Data Sources lists PostgreSQL, MySQL, SQLite, none unavailable), the version, `dailyLoop` on SQLite, a settings change surviving relaunch, and — under `DATABASES_ENABLED` — connect and `SELECT 1` on PostgreSQL and MySQL to prove the bundled `pg` and `mysql2`.                                                                         |
| 14  | **Scripts.** `test:smoke:packaged` = `desktop:package:dir`, then the packaged suite with `TABLE_CRAFT_APP_EXECUTABLE` set to the host's unpacked executable (`scripts/packaged-executable.ts` knows the per-OS path under `packages/desktop/release/`). `test:smoke:packaged:db` adds the containers.                                                                                                                                                                                                                                                                                                                              |
| 15  | **CI (GitHub Actions, `.github/workflows/ci.yml`).** On push and pull request: `verify` (ubuntu) runs lint, format:check, typecheck, test, then test:db with the compose containers — blocking. `package` matrix: macOS arm64 (`macos-14` or newer), macOS x64 (the current Intel label — check GitHub's runner list), Windows (`windows-latest`), Linux (`ubuntu-latest` under `xvfb-run`); each packages its installer, runs `test:smoke:packaged` (SQLite), and uploads the installer as an artifact. macOS jobs block; Windows and Linux have `continue-on-error: true`. Bun via `oven-sh/setup-bun` pinned to `.bun-version`. |
| 16  | **Releases.** A pushed `v*` tag runs the same workflow and, after every blocking job passes, attaches the installers to a **draft** GitHub Release (`gh release create --draft`). Not exercised by this plan: no tag is pushed (the user cuts the first release).                                                                                                                                                                                                                                                                                                                                                                  |
| 17  | **The full `test:smoke:db` stays local.** Its 15 suites assume the macOS keymap and take ~20 min; CI runs the packaged suite on every OS and the contract suite against real databases, which is what catches platform breakage.                                                                                                                                                                                                                                                                                                                                                                                                   |
| 18  | **Loose ends fixed here, each with a regression test:** (a) the completion flake — `acceptCompletion` waits for the option to be `aria-selected` instead of sleeping, and its `expect.poll` gets an explicit timeout; (b) Services row count updates after Fetch All; (c) the console status and the Services row say `Waiting for confirmation…` (not `Running…`) while a destructive or analyse confirm is open, and the timer starts after the answer; (d) a failed table submit records a history entry with outcome `error` and the script.                                                                                   |
| 19  | **Coverage check.** Before writing new scenarios, the implementer confirms by reading test bodies that DROP and CREATE generation (`ddl.smoke`) and TSV export (`grid.smoke`) are exercised; any of decision 014's named features without a scenario gets one in its feature suite.                                                                                                                                                                                                                                                                                                                                                |

### Consequences worth naming

**This is a behaviour change.** The app gets an icon, an About entry and a real version; the
console and Services show `Waiting for confirmation…` while a dialog is open, where they showed
`Running…`; a failed table submit now appears in Query History.

**This default was chosen without asking.** Ad-hoc signing only (no Developer ID, no
notarisation); separate DMGs rather than a universal binary; no auto-update; Windows and Linux CI
jobs may fail without failing the run; untagged builds are `0.0.0-dev.<sha>`; built-in plugins are
readable files in the installed app.

**This adds infrastructure the repo did not have.** `.github/workflows/ci.yml` runs on every push
to GitHub. The implementer iterates on CI on a throwaway branch (`plan-014-ci`), deletes it, and
lands the green workflow on `main`.

No plugin contract or engine protocol change.

---

## Phase 0 — Paths and dependencies

| File                                 | Responsibility                                                                         |
| ------------------------------------ | -------------------------------------------------------------------------------------- |
| `packages/desktop/src/main/paths.ts` | `appPaths(...)` per decision 2; pure, no `electron` import                             |
| `packages/desktop/src/main/main.ts`  | builds the input from `app.isPackaged`, `process.resourcesPath`, `import.meta.dirname` |
| `packages/desktop/package.json`      | runtime `dependencies` → `devDependencies`                                             |

```ts
export interface AppPaths {
  readonly engineEntry: string;
  readonly preload: string;
  readonly rendererIndex: string;
  readonly builtInPlugins: string;
}
export function appPaths(input: {
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  readonly distDirectory: string;
}): AppPaths;
```

`bun run desktop` behaves exactly as before.

## Phase 1 — electron-builder, icon, version, About

- `electron-builder.yml`: decisions 1, 5, 6; `extraResources` filter excludes `*.map`; `files`
  excludes `dist/resources/**` and `**/*.map`; `asar: true`; `icon: build/icon.png`;
  `mac.hardenedRuntime`, `mac.entitlements(Inherit)`: `build/entitlements.mac.plist`.
- `scripts/version.ts`, `scripts/render-icon.ts`, `scripts/packaged-executable.ts` (Bun is fine
  here: not under `src/`).
- Root scripts `desktop:package`, `desktop:package:dir`, `test:smoke:packaged`,
  `test:smoke:packaged:db`.
- `main.ts`: `setAboutPanelOptions`, window `icon` on Linux/Windows; `app.about` action and
  Help-menu entry (non-mac, plan 013's menu flag).
- Build a DMG for arm64 and x64 locally; launch the arm64 app by hand once; launch x64 under
  Rosetta if installed (otherwise CI covers it).

## Phase 2 — Harness and suites

- `harness.ts`: `LaunchOptions.executable`, `TABLE_CRAFT_APP_EXECUTABLE`, `closeApp`; every suite
  moves to `closeApp`.
- `test/e2e/workflows.ts`, `workflows.smoke.test.ts`, `packaged.smoke.test.ts` (decisions 12–14).
- Decision 19's coverage check and any missing scenarios.

## Phase 3 — Loose ends

Decision 18 (a)–(d), each fix with its test before the next.

## Phase 4 — CI

`.github/workflows/ci.yml` per decisions 15–16, iterated on `plan-014-ci` until `verify` and both
macOS package jobs are green and the Windows and Linux jobs have run (their result, green or red
with the reason, goes in the Live test table). Use `gh run watch` / `gh run view --log-failed`.

## Phase 5 — Fixtures, tests, docs

No fixture schema change.

New `test/desktop/paths.test.ts`, `test/desktop/version.test.ts` (the tag/sha rule with an
injected `git`), `test/desktop/package.test.ts` (gated on a built `release/` directory: lists
`app.asar` with `@electron/asar` and asserts `dist/main/main.js`, `dist/engine/main.js`,
`dist/renderer/index.html` present, no `node_modules`, no `.map`; asserts
`<resources>/plugins/{sqlite,postgres,mysql}/table-craft-plugin.json`).

New cases:

`givenDevelopmentRun_whenPathsResolved_thenEverythingUnderDist`,
`givenPackagedRun_whenPathsResolved_thenPluginsUnderResourcesAndBundlesInAsar`,
`givenTaggedHead_whenVersionComputed_thenTagWithoutV`,
`givenUntaggedHead_whenVersionComputed_thenDevPrereleaseWithSha`,
`givenTwoTagsOnHead_whenVersionComputed_thenFailsNamingBoth`,
`givenPackagedApp_whenListed_thenNoNodeModulesAndNoSourceMaps`,
`givenPackagedApp_whenListed_thenEveryBuiltInPluginBesideTheArchive`,
`givenPackagedApp_whenLaunched_thenAllBuiltInPluginsAvailable`,
`givenPackagedApp_whenLaunched_thenVersionIsTheBuiltOne`,
`givenPackagedApp_whenDailyLoopOnSqlite_thenEveryStepSucceeds`,
`givenPackagedApp_whenSettingChangedAndRelaunched_thenKept`,
`givenPackagedApp_whenPostgresAndMysqlConnected_thenSelectOneReturns`,
`givenDailyLoop_whenRunOn{Sqlite,Postgres,Mysql}_thenEveryStepSucceeds`,
`givenFetchAll_whenFinished_thenServicesRowShowsAllRows`,
`givenDestructiveConfirmOpen_whenStatusRead_thenWaitingForConfirmation`,
`givenTableSubmitFails_whenHistoryOpened_thenErrorEntryWithScript`,
`givenCompletionOpen_whenOptionSelected_thenEnterAcceptsWithoutSleeping`.

Docs: `specification.md` gains a **Packaging** section (layout, targets, version rule, signing,
About, how to run the packaged suite); AGENTS.md Commands gains `desktop:package:dir`,
`test:smoke:packaged[:db]`, `TABLE_CRAFT_APP_EXECUTABLE`, and the CI note; Layout gains
`.github/workflows/` and `packages/desktop/build/`; decision 013's "drives the packaged app" is now
true, so it gets no amendment, but decision 014's CI sentence gets a link to the workflow;
`electron-builder.yml`'s stale header comment goes.

---

## Live test

Run with `TABLE_CRAFT_EVIDENCE_DIR=docs/evidence/014` through `bun run test:smoke:packaged:db`
(suite `test/e2e/packaged.smoke.test.ts`) and `bun run test:smoke:db` (suite
`test/e2e/workflows.smoke.test.ts`), window 1200×800. CI rows cite the run URL instead of a PNG.

| #   | Scenario                                                            | Database        | Result                                                                                                                                                                                                                                                                                | Evidence                                                                                                                                               |
| --- | ------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Packaged arm64 app launches; Data Sources lists all three plugins   | —               | Pass. `release/mac-arm64/table-craft.app` (ad hoc signed, `app.isPackaged` true) launches with its engine forked from `app.asar`; New Data Source… lists MySQL, PostgreSQL and SQLite, none unavailable                                                                               | `docs/evidence/014/packaged-plugins.png`                                                                                                               |
| 2   | About shows the built version                                       | —               | Pass. Find Action → About table-craft shows `table-craft 0.0.0-dev.5039c19` (the version `scripts/version.ts` computes for `HEAD`) and `Electron 43.8.3 · Chromium 150.0.7871.250`; `app.getVersion()` agrees                                                                         | `docs/evidence/014/packaged-about.png`                                                                                                                 |
| 3   | Daily loop in the packaged app, ending on the Explain Plan tab      | sqlite          | Pass. All 15 steps on the seeded SQLite file, from Connect to Explain Plan; the window ends on the Plan tab (`SCAN o`, `SEARCH c USING INTEGER PRIMARY KEY`)                                                                                                                          | `docs/evidence/014/packaged-loop.png`                                                                                                                  |
| 4   | Bundled drivers connect from the packaged app                       | postgres, mysql | Pass. Saved `pg` and `mysql` connect through the password prompt; `SELECT 1 AS one` returns `1` in each console (PostgreSQL 17, MySQL 8.4.11), so the bundled `pg` and `mysql2` load from `<resources>/plugins`                                                                       | `docs/evidence/014/packaged-drivers.png`                                                                                                               |
| 5   | A theme change survives relaunch of the packaged app                | sqlite          | Pass. Settings → Appearance → Dark on a light host; after quitting and relaunching on the same profile, Dark is still checked and the window is dark                                                                                                                                  | `docs/evidence/014/packaged-relaunch.png`                                                                                                              |
| 6   | Daily loop on the dev build                                         | postgres        | Pass. All 15 steps on PostgreSQL 17.11; Search Everywhere shows `customers pg › table_craft › public`; the plan is a Nested Loop over `orders o` and `customers c`                                                                                                                    | `docs/evidence/014/loop-postgres.png`                                                                                                                  |
| 7   | Daily loop on the dev build                                         | mysql           | Pass. All 15 steps on MySQL 8.4.11; the plan is a nested loop inner join with a single-row index lookup on `c`                                                                                                                                                                        | `docs/evidence/014/loop-mysql.png`                                                                                                                     |
| 8   | Services shows the full row count after Fetch All                   | postgres        | Pass. `generate_series(1, 5000)` shows 500 rows, then Fetch All: the grid reads `5,000 rows` and the Services execution row `5000 rows`                                                                                                                                               | `docs/evidence/014/services-fetch-all.png`                                                                                                             |
| 9   | `Waiting for confirmation…` while a destructive confirm is open     | sqlite          | Pass. `DELETE FROM orders` opens the destructive confirm; the console status reads `Waiting for confirmation…` and the Services row `console waiting for confirmation…` in the warning colour, with no execution row; Cancel returns it to idle                                       | `docs/evidence/014/waiting-confirm.png`                                                                                                                |
| 10  | Failed table submit appears in Query History as an error            | postgres        | Pass. Setting order 1's total to `-1` fails on `orders_total_nonnegative`; Query History lists `UPDATE "public"."orders" SET "total" = '-1' WHERE "id" = 1;` with the error dot, the message and the script in the preview                                                            | `docs/evidence/014/history-failed-submit.png`                                                                                                          |
| 11  | x64 DMG built (and launched under Rosetta, or on CI's Intel runner) | sqlite          | Pass. `bun run --cwd packages/desktop package --x64` built `table-craft-0.0.0-dev.8379c80-x64.dmg` (x86_64 app); the packaged suite against `release/mac/table-craft.app` under Rosetta: 4 passed, 1 skipped (databases off). CI's `macos-15-intel` job built and smoke-tested it too | `packages/desktop/release/table-craft-0.0.0-dev.8379c80-x64.dmg` (not committed); https://github.com/tranphucbol/table-craft/actions/runs/39762558137  |
| 12  | CI `verify` and macOS package jobs green on `main`                  | —               | Pass. `verify` (lint, format, typecheck, `test` 783 passed, `test:db` 166 passed) and both macOS jobs (`macos-15` arm64, `macos-15-intel` x64) built the DMG and passed the packaged suite, 4 passed and 1 skipped each; the release job skipped (no tag)                             | https://github.com/tranphucbol/table-craft/actions/runs/39768931270                                                                                    |
| 13  | CI Windows NSIS and Linux AppImage jobs ran (result and reason)     | sqlite          | Pass. Both built their installer and passed the packaged suite, 4 passed and 1 skipped (Linux under `xvfb-run`). The first `main` run failed Windows on the relaunch scenario's race (deviation 17), non-blocking as planned; the fix's run is green on all five jobs                 | https://github.com/tranphucbol/table-craft/actions/runs/39768931270; failed first: https://github.com/tranphucbol/table-craft/actions/runs/39767785142 |

---

## Deviations taken while implementing

**1. Ad-hoc builds turn the hardened runtime off.** Decision 6 as written does not launch: with
`identity: "-"` and `hardenedRuntime: true` the arm64 app dies in dyld (`Library not loaded: …
Electron Framework … different Team IDs`), because library validation refuses the ad-hoc-signed
framework, which has no Team ID. `electron-builder.yml` keeps `hardenedRuntime` and the
entitlements for a Developer ID build and names no identity; `scripts/package.ts` adds
`-c.mac.identity=- -c.mac.hardenedRuntime=false` when neither `CSC_LINK` nor `CSC_NAME` is set.
`codesign -dv` reports `flags=0x2(adhoc)` and the app launches. The alternative,
`disable-library-validation`, would weaken the Developer ID build too.

**2. Packaging goes through `scripts/package.ts`.** One script computes the version, adds the host
platform and architecture (unless `--x64` or `--arm64` is passed), the signing flags of
deviation 1 and `--publish never`; `package` and `package:dir` in the desktop package call it.
It must run through `bun run`, which puts `electron-builder` on `PATH`.

**3. The icon is rendered with Electron's Chromium, under Node.** Playwright has no downloaded
browser in this repository, so `render-icon.ts` drives a blank Electron window through `_electron`;
under Bun that connection hangs, so it runs as
`node --experimental-strip-types packages/desktop/scripts/render-icon.ts`.

**4. `AppPaths` has an `icon` field,** and `build/icon.png` ships as `<resources>/icon.png`: the
window on Windows and Linux and the dock in a development run need a file, and the bundle's
`.icns`/`.ico` are not one.

**5. About reads its facts over a new invoke channel, `app.info`.** Only main knows the version,
Electron and Chromium; the renderer action asks for them. The notice dialog gains `tone: "info"`
so the version is not drawn in the danger colour. A development run reports `0.0.0` from a
constant, because an unpackaged `app.getVersion()` returns Electron's version.

**6. A non-release tag leaves the dev version.** `version.ts` counts only tags matching
`vX.Y.Z`; `nightly` or `v1.2` on HEAD gives `0.0.0-dev.<sha>`
(`givenNonReleaseTagOnHead_whenVersionComputed_thenDevPrereleaseWithSha`). NSIS accepted the
prerelease form (an x64 installer built on macOS), so no `-c.buildVersion` was needed.

**7. Installers carry their architecture.** electron-builder's default leaves the x64 DMG
unnamed, which reads as universal beside the arm64 one, so `artifactName` is
`${productName}-${version}-${arch}.${ext}`. Linux sets `executableName: table-craft`, else the
binary is named after the package, `@table-craft/desktop`.

**8. More package and packaged assertions.** `package.test.ts` also checks the preload bundle
(`givenPackagedApp_whenListed_thenBundlesInTheArchive`), and the packaged suite asserts
`app.isPackaged` so it cannot pass against a development build by mistake.

**9. The daily loop retries the filter's Enter.** Under Rosetta the x64 app showed the WHERE/ORDER BY
completion popup opening just before Enter, which then accepted the completion instead of
applying the filter. DataGrip behaves the same, so the product is unchanged; `applyFilter` in
`workflows.ts` presses Enter until the Services tree shows the reload, at most three times.

**10. Decision 19 found three gaps and filled them.** TSV export, the generator's CREATE and DROP,
and Revert Selected / Revert All had no scenario:
`givenTsvExtractor_whenExported_thenFileIsTabSeparated` (grid),
`givenSqliteOrders_whenGeneratingDropThenCreateAndRunningBoth_thenTheTableIsBackEmpty` (ddl),
`givenSqliteEditProbePending_whenRevertSelectedThenRevertAll_thenValuesBackAndNothingPending`
(table editor).

**11. Bug: a SQLite view over a dropped table failed its whole schema.** Found by the DROP scenario
of deviation 10: `customer_totals` reads `orders`, and once `orders` was dropped
`pragma_table_xinfo` on the view threw, so the `main` node showed `failed · no such table` instead
of the remaining tables. `plugins/sqlite/src/introspect.ts` now lists such a view without columns.
Regression test: `givenViewOverDroppedTable_whenSchemaDescribed_thenViewListedWithoutColumns`
(`test/plugins/sqlite.test.ts`), and the ddl scenario asserts `tables 5` and `views 1` after the
drop.

**12. Completion acceptance waits for more than `aria-selected`.** The option is selected before
CodeMirror will take Enter: it also ignores Enter for its 75 ms `interactionDelay` and while a
source is pending (the popup carries `cm-tooltip-autocomplete-disabled`). `acceptCompletion` polls
all three plus the selected label through `page.evaluate`; `waitForFunction` was the first try, but
it re-evaluates a string, which the window's CSP refuses (`unsafe-eval`).

**13. The Services row reads `waiting for confirmation…`,** lower case like its siblings (`idle`,
`running`); the console status reads `Waiting for confirmation…` as decided.

**14. A failed submit's script is previewed again.** The submit failure names no statements, so on
failure the table store previews the same edits (`edits.preview`) and records that script. If the
preview fails too, the Services row shows the error and nothing is recorded
(`givenSubmitAndPreviewFail_whenSubmitted_thenErrorExecutionAndNoHistory`).

**15. CI specifics.** The runners are `macos-15` (arm64) and `macos-15-intel`, GitHub's current
Intel label. The Linux job lifts Ubuntu 24.04's AppArmor restriction on unprivileged user
namespaces (`kernel.apparmor_restrict_unprivileged_userns=0`) before `xvfb-run`, which Chromium's
sandbox needs. Actions are at their Node 24 majors (`checkout@v7`, `upload-artifact@v7`,
`download-artifact@v8`); the first run on v4 warned that Node 20 is deprecated.

**16. Bug (test): reading a column could stall for 30 seconds.** `loop-sqlite.png` from the full
`test:smoke:db` run showed 31 s between the orders and edit_probe loads, and a timed run put it all
in "filter and sort". The `columnValues` helpers (table editor, grid, daily loop) listed a column's
cells and then read each one; when the filter re-rendered three rows as two between the two calls,
the vanished cell's read waited out Playwright's 30 s default before `expect.poll` retried and
passed. The harness's `columnSnapshot` now reads a column in one `evaluateAll`, and all three
helpers use it; the timed rerun's slowest step took under half a second. The flake in
`datasources.smoke` seen once in the full run (a datasource left `failed`) did not reproduce in
three isolated runs or in later full runs; four Electron processes orphaned by earlier interrupted
runs were running at the time and were killed.

**17. Bug (test): the relaunch scenario closed the app before the setting was on disk.** The first
CI run on `main` failed the Windows job: after relaunch Dark was not checked. The renderer checks the
option as soon as it is clicked, while main writes `settings.json` (temporary file, then rename)
afterwards, and closing the app kills it; on the Windows runner the close won. The scenario now
waits for `settings.json` to hold `dark` before closing, and polls the relaunched dialog. A user who
quits within milliseconds of a change can still lose it; flushing pending writes on quit is a
follow-up, not part of this plan.

---

## Out of scope

- Developer ID signing and notarisation: needs the shipper's Apple credentials; the config is
  ready for them (decision 6).
- Auto-update, a universal macOS binary, Windows/Linux arm64, MSI, deb/rpm, Snap, Flatpak.
- Pushing a release tag or publishing a release: the user cuts the first one.
- Running the full `test:smoke:db` in CI (decision 17).
- Cancelling table loads and submits from Services (plan 011's open item): a feature, not a loose
  end.
- Keymap editing, date/time formats, a per-console schema switcher: not in decision 014.
