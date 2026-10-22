# Plan: Settings and appearance

Status: done. `⌘,` (Settings… in the macOS app menu, File → Settings… on Windows and Linux)
opens a Settings dialog with three pages that save as they change: Appearance (Follow system,
Dark, Light, High contrast and the user themes in `<userData>/themes/`, with Reload Themes and
Open Themes Folder; Comfortable or Compact density; the UI font), Editor (the editor font; `⌘=`,
`⌘-`, `⌘0` zoom it in the console) and Data Editor (the grid font, NULL text, digit grouping, page
size and Fetch All limit). The preferences are `<userData>/settings.json`, owned by main, read
field by field so one bad value falls back alone, and set aside as `.corrupt-<ms>` with a notice in
the Database pane when the file cannot be read. The renderer loads them before its first render
and applies every change live, including Follow system tracking `prefers-color-scheme` and
`prefers-contrast`; main sets `nativeTheme` and paints the window in the theme's canvas from the
first frame. The three themes are pure data shared by main and the renderer, and a unit test
measures 25 WCAG contrast pairs in each; six Dark tokens changed to pass. A user theme names a
base and overrides colour tokens; a broken one is listed with its errors and cannot be chosen.
Compact rows are 20 px and the grid and Database pane virtualise at the live height. NULL text and
digit grouping change what the grid draws and measures, never what is copied, exported, filtered,
edited or recorded. The page size and cap travel with each `statement.execute`, `table.query` and
`result.fetchMore`, so the engine keeps no preferences, and a result keeps the paging it ran with.
`queryLocalFonts()` needed no permission handler in Electron 43.

## The issue

Decision 014 ships "Settings and appearance: themes, user themes, three font settings, density,
data-editor formats" (`docs/decisions/014-what-v1-ships.md:25`), and decision 012 says how: typed
token sets with Dark, Light, High contrast and "follow system"; JSON user themes in
`<userData>/themes/` validated against the token schema; UI, editor and grid fonts each with
family and size, listed through `queryLocalFonts()`; a compact and a comfortable density; `⌘+` /
`⌘-` zooming the editor font; everything applied live and persisted in app settings
(`docs/decisions/012-appearance-is-data.md:7-16`). Plan 007 deferred page size and the Fetch All
cap to this plan (`docs/plans/007-result-grid.md:71-72,260`).

None of it exists. There is one colour set, `DARK_COLORS` (`renderer/appearance/tokens.ts:115-158`),
one density, `COMFORTABLE_DENSITY` (`:166-188`), and fixed fonts, `DEFAULT_FONTS` (`:160-164`).
`applyAppearance` runs once, before the first render (`renderer/main.tsx:10`), and nothing applies
it again. `app.css:73` pins `color-scheme: dark`. `settings.json` is named in decision 010
(`:15`) and in a comment (`renderer/state/layout.ts:4-7`) and nowhere else. Main never touches
`nativeTheme` and gives the window no `backgroundColor` (`main/main.ts:117-133`), so the first
paint is Electron's default. There is no Settings command, no `⌘,`, and macOS's app menu is the
bare `appMenu` role (`main/menu.ts:34`). The design system still says the token list, density
values and contrast pairs are "to be filled in" (`docs/design/design-system.md:7-8`), and no test
checks a contrast ratio.

Three things will break the moment density or paging becomes a choice:

- The grid and the Database pane virtualise rows with `ROW_HEIGHT_PX`, a module constant read from
  `DEFAULT_APPEARANCE` at import (`grid/ResultGrid.tsx:55,206-211,294`;
  `panes/DatabasePane.tsx:122,441`), while the DOM draws rows at `var(--tc-row-height)`. A compact
  row would leave the virtualiser placing rows 24 px apart.
- The engine's `ResultStore` takes its page size and cap from module defaults
  (`core/src/results/store.ts:6-10,54`; `engine/engine.ts:294`), and the renderer has no way to
  pass others (`engine/requests.ts:67`).
- `formatCell` (`renderer/grid/format.ts:11-26`) draws the cell and also measures it for column
  widths (`grid/widths.ts:27-33,41-52`); a format applied in one place and not the other misaligns
  columns.

DataGrip's model (`docs/design/datagrip-inventory.md`): Settings on `⌘,` (`:915`); themes Dark,
Light, High Contrast and Sync with OS (`:867-875`), Compact Mode as density (`:85-87,877`);
editor font family and size, data editor font, page size, number formatting (`:886-899`); grid
zoom (`:513`). Keymap editing (`:916-917`) and date/time patterns (`:898`) are discussed under Out
of scope.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Where settings live** (decision 032). `<userData>/settings.json`, owned by a new `main/settings.ts` modelled on `main/datasources.ts`: `SETTINGS_VERSION = 1`, a `MIGRATIONS` map, `writeAtomically`, and a file that is not JSON or not the right shape renamed to `settings.json.corrupt-<ms>` with a warning. Unlike datasources, each field is parsed on its own with its default as the fallback, so one out-of-range number does not discard the file; only an unparsable file or a newer version is set aside                                                                           |
| 2   | **The document.** `{ version: 1, appearance: { theme, density, fonts: { ui, editor, grid } }, data: { nullText, groupDigits, pageRows, fetchAllCap } }`. `theme` is `"system" \| "dark" \| "light" \| "highContrast" \| "user:<file stem>"`, default `"system"`; `density` is `"comfortable" \| "compact"`, default comfortable; each font is `{ family: string \| null, sizePx }`, `null` meaning the built-in stack. Defaults, ranges and the type live in one pure module, `packages/desktop/src/settings/settings.ts`, shared by main and the renderer                                       |
| 3   | **Ranges.** Font sizes 8–32 px (defaults: UI 13, editor 13, grid 12, today's `DEFAULT_FONTS`). `pageRows` 10–10,000, default 500. `fetchAllCap` 1,000–1,000,000 and at least `pageRows`, default 100,000. `nullText` 1–16 characters, default `<null>`. `groupDigits` default false. The dialog refuses an out-of-range value inline; the file parser clamps nothing, it falls back to the default                                                                                                                                                                                               |
| 4   | **Channels.** `INVOKE_CHANNELS` gains `settings.read` (the document, the warning if the file was set aside, and the theme list of decision 7) and `settings.write` (the whole document; main validates, saves, then broadcasts). `CHANNELS` gains `settingsChanged`, carried by `broadcast` (`main/main.ts:90-92`, whose payload union widens). `themes.reload` rereads the folder; `themes.openFolder` creates it if missing and opens it with `shell.openPath`. Each has a zod request in `main/ipc.ts` and a bridge method                                                                    |
| 5   | **Renderer store.** `renderer/state/settings.ts`: loaded before the first render (`main.tsx` awaits `settings.read`, then applies, then mounts, so no frame shows the wrong theme), replaced on `settingsChanged`, and changed only through `update(patch)`, which writes through the bridge. It never writes `localStorage`. The wiring that applies appearance subscribes in `state/wiring.ts`                                                                                                                                                                                                 |
| 6   | **Built-in themes.** The token types and the three colour sets move to a pure module, `packages/desktop/src/appearance/themes.ts` (no DOM, Node, electron or zod; the ESLint fences gain a group for it), imported by main for the window background and by the renderer. Dark keeps today's values; Light is IntelliJ Light-like; High contrast is black with white ink and saturated accents. `syntax` and `datasource` tints are themed too. `colorScheme` is part of each theme and replaces the pinned `color-scheme: dark` (`app.css:73`)                                                  |
| 7   | **User themes.** `<userData>/themes/*.json`, each `{ name, base: "dark" \| "light" \| "highContrast", colors: { …partial ColorTokens, syntax?: partial, datasource?: partial } }`. Main validates with zod (`z.strictObject`, colours `#rgb`, `#rrggbb` or `#rrggbbaa`, at most 64 files of at most 64 KiB), resolves over the base, and sends `{ id: "user:<stem>", name, colors }` or `{ id, file, errors: string[] }`. Fonts and density are not themeable. Contrast is not enforced for user themes                                                                                          |
| 8   | **Follow system.** `"system"` picks High contrast when `prefers-contrast: more` matches, else Dark or Light from `prefers-color-scheme`; the renderer listens to both media queries and reapplies on change. Main sets `nativeTheme.themeSource` to `"system"`, `"dark"` or `"light"` (High contrast and user themes take their base's scheme) and the window's `backgroundColor` to the resolved canvas, at launch and on every write                                                                                                                                                           |
| 9   | **Contrast is tested.** A pure `contrastRatio(foreground, background)` (WCAG 2.1 relative luminance) and a list of pairs in the theme module: ink, inkMuted and accent on canvas, panel and raised; accentInk on accent; danger, success and warning on panel; every syntax colour on canvas; gridNull on canvas. Dark and Light must reach 4.5:1 for text pairs and 3:1 for non-text, High contrast 7:1 for ink and 4.5:1 for the rest. Today's Dark values are adjusted where they fall short, as a deviation listing each change                                                              |
| 10  | **Fonts.** The settings page lists families from `queryLocalFonts()` (deduplicated by family), monospace families first for the editor and grid fonts, judged by comparing the canvas `measureText` widths of `i` and `W`, plus a free-text field when the API is unavailable, refused or returns nothing. The chosen family is written ahead of the built-in stack, so a missing font falls back. The live test checks whether Electron grants `local-fonts` without a handler; if not, main grants that permission alone, recorded as a deviation                                              |
| 11  | **Density.** Compact: 20 px rows, 6 px cell padding, 6 px gap; every other density token as comfortable unless the live test shows it overflowing. `ROW_HEIGHT_PX` goes: the grid and the Database pane read the row height from the settings store and pass it to `useVirtualizer` (and to PageUp/PageDown), so the virtualiser and the DOM agree. The editor's `LINE_HEIGHT` (`console/editorTheme.ts:17`) is unchanged                                                                                                                                                                        |
| 12  | **Editor zoom.** `editor.zoomIn` `Mod+=`, `editor.zoomOut` `Mod+-`, `editor.zoomReset` `Mod+0`, region `editor`, category `Editor`: ±1 px on the editor font size within the range, reset to 13, saved like any other change. `Mod+-` already collapses the tree in the `database` region (`actions/explorerActions.ts:98`); decision 027 lets both stand, and the keymap test proves it. No `zoomIn`/`viewMenu` role is added to the native menu, so Electron never zooms the whole page                                                                                                        |
| 13  | **Data formats** (decision 032, display only). `formatCell(value, typeClass, formats)` draws `nullText` for NULL and, with `groupDigits`, inserts `,` every three digits in the integer part of an `integer`, `decimal`, `float` or `bigint` value whose text matches `^-?\d+(\.\d+)?$`; anything else (exponents, `NaN`, `Infinity`) is drawn as printed. The decimal point is left alone. Widths use the same call. The value panel, copy, extractors, filters, the table editor's input and history keep raw text                                                                             |
| 14  | **Paging travels with each request** (decision 032). `statement.execute`, `table.query` and `result.fetchMore` gain `pageRows` and `fetchAllCap`; `ResultStore.put` and `fetchMore` take them instead of `DEFAULT_LIMITS`. The window size the grid requests (`RESULT_WINDOW_ROWS`, 500) is not a preference. The grid's "N+ rows" and Fetch All texts (`grid/GridToolbar.tsx:58`, `model/format.ts:93`) read the settings, and a change applies to the next statement, not to open results                                                                                                      |
| 15  | **The Settings dialog.** `settings.show`, title "Settings…", category `App`, `Mod+,`, opens a Radix dialog shaped like Data Sources (`dialogs/DataSources.tsx:470-645`): pages on the left, the page on the right, Close at the bottom. Pages: **Appearance** (theme as a list with the user themes and their errors, Reload Themes, Open Themes Folder; density as two radios; UI font), **Editor** (editor font; a line naming the zoom chords), **Data Editor** (grid font, NULL text, group digits, page size, Fetch All cap). Each page has Restore Defaults. Changes save as they are made |
| 16  | **Menus.** On macOS the app menu becomes explicit: About, separator, Settings… `⌘,`, separator, Services, Hide, Hide Others, Show All, separator, Quit, so Settings sits where macOS users look. On Windows and Linux, File gains Settings… above its last separator. Both send the action like every other menu item (`main/menu.ts:7-26`)                                                                                                                                                                                                                                                      |
| 17  | **Window background.** `createWindow` passes `backgroundColor` from the resolved theme's canvas (decision 8). For `"system"` main uses `nativeTheme.shouldUseDarkColors` and `shouldUseHighContrastColors`                                                                                                                                                                                                                                                                                                                                                                                       |

## Consequences worth naming

**This crosses the fence.** New invoke channels `settings.read`, `settings.write`,
`themes.reload`, `themes.openFolder`; a new main-to-renderer channel `settingsChanged`; three
engine requests gain `pageRows` and `fetchAllCap`. A new shared, pure `appearance/` and
`settings/` module under `packages/desktop/src`, imported by main and the renderer.

**This is a behaviour change.** With no settings file the app follows the system's light or dark
scheme instead of always being dark. Dark tokens that fail the contrast test change colour. The
window paints its theme's canvas from the first frame.

**This default was chosen without asking.** Theme "system"; changes save immediately with no
Apply; digit grouping off and a comma separator; ranges in decision 3; compact density values;
user themes cannot change fonts or density; zoom changes the saved editor size rather than a
per-tab zoom.

## Phase 0 — Settings, themes and contrast as data (pure)

| File                                        | Responsibility                                                                                                                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/desktop/src/appearance/themes.ts` | token types (moved from `renderer/appearance/tokens.ts`), Dark, Light, High contrast, densities, `contrastRatio`, the contrast pairs, `resolveTheme(settings, system, userThemes)` |
| `packages/desktop/src/settings/settings.ts` | the `Settings` type, `DEFAULT_SETTINGS`, ranges, `readSettings(unknown)` field by field (no zod: the renderer imports it)                                                          |
| `renderer/appearance/tokens.ts`, `apply.ts` | re-export from the shared module; `appearanceOf(settings, theme)` builds the `Appearance`; `apply` also sets `color-scheme`                                                        |
| `eslint.config.js`                          | the shared modules may import neither DOM-only, Node, electron nor zod                                                                                                             |

## Phase 1 — Main: the file, user themes, the window

| File                              | Responsibility                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `main/settings.ts`                | load, migrate, set aside, save; the zod file schema                                                     |
| `main/themes.ts`                  | list, validate and resolve `<userData>/themes/*.json`                                                   |
| `main/main.ts`                    | load settings before `createWindow`; `backgroundColor`; `nativeTheme.themeSource`; the themes directory |
| `main/ipc.ts`, `preload/*`        | the channels of decision 4                                                                              |
| `main/menu.ts`, `preload/menu.ts` | the explicit macOS app menu and File → Settings… elsewhere                                              |

## Phase 2 — Engine paging

`core/src/results/store.ts` takes limits per call; `engine/protocol.ts`, `requests.ts` and
`engine.ts` carry `pageRows` and `fetchAllCap`; the renderer's three callers pass the store's
values.

## Phase 3 — Renderer: store, live appearance, formats, dialog, actions

| File                                            | Responsibility                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| `state/settings.ts`                             | the store of decision 5                                                |
| `state/wiring.ts`, `main.tsx`                   | load before mount; reapply on change and on the two media queries      |
| `grid/ResultGrid.tsx`, `panes/DatabasePane.tsx` | live row height for the virtualiser                                    |
| `grid/format.ts`, `grid/widths.ts`              | `formatCell` with formats; widths through the same call                |
| `grid/GridToolbar.tsx`, `model/format.ts`       | page and cap texts from the settings                                   |
| `dialogs/Settings.tsx`, `settings/fonts.ts`     | the dialog and its pages; the font list and the monospace check        |
| `actions/settingsActions.ts`                    | `settings.show`, the three zoom actions; registered in `allActions.ts` |

## Phase 4 — Fixtures, tests, docs

- `test/appearance/themes.test.ts`: `givenEachBuiltInTheme_whenPairsMeasured_thenMeetTheirContrast`,
  `givenUserThemeOverridingTwoTokens_whenResolved_thenRestComeFromBase`.
- `test/desktop/settings.test.ts` after `datasources.test.ts`: no file gives defaults; v1 round
  trip; corrupt file set aside; newer version set aside; one out-of-range field falls back alone;
  write killed halfway leaves the old file whole.
- `test/desktop/themes.test.ts`: valid, unknown token, bad colour, bad base, not JSON, too large.
- `test/renderer/settingsStore.test.ts`, `format.test.ts` (grouping cases incl. `-1234.5`,
  `1e10`, `NaN`, bigint), `keymap.test.ts` stays green with the zoom chords.
- `test/core/results.test.ts`: a page size of 10 reads 10, Fetch All stops at the cap given.
- `test/e2e/harness.ts`: `seedSettings(userDataDir, settings)` and `seedTheme(userDataDir, name, json)`.
- Smoke tests that assume 24 px rows or 500-row pages (`grid.smoke.test.ts:61-62`) keep the
  defaults; none needs changing unless the live test shows otherwise.
- Docs: `docs/design/design-system.md` gets the full token list, both densities, the three themes
  and the contrast pairs (replacing `:7-8`), a Settings dialog section and "Light / comfortable"
  columns where tables show only Dark; `docs/design/specification.md` gets Settings, the menus,
  the new channels and requests, and the page size and cap as settings (`:355-357`); AGENTS.md
  layout gains `appearance/` and `settings/`; decision 012's "`Cmd +`" wording stays true.

## Live test

Run `TABLE_CRAFT_EVIDENCE_DIR=docs/evidence/013 bun run test:smoke:db`, suite
`test/e2e/settings.smoke.test.ts`, window 1200×800.

| #   | Scenario                                                                                                                                       | Database          | Result                                                                                                                                                                                                                                                                                 | Evidence                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 1   | `⌘,` opens Settings on Appearance; the app menu's Settings… opens it too                                                                       | SQLite            | Pass. `⌘,` opens Settings on Appearance; Settings… in the app menu (clicked through `Menu.getApplicationMenu()`) opens it again on Appearance; each page fits the 1200×800 window without scrolling                                                                                    | `settings-appearance.png` |
| 2   | Choosing Light restyles the explorer, console, grid and Services at once; `settings.json` holds `"light"`                                      | SQLite            | Pass. From emulated dark, choosing Light changes the Database tree row, the console's editor, a grid cell and the Services row backgrounds at once; `color-scheme` is `light`; `settings.json` holds `"theme": "light"`                                                                | `theme-light.png`         |
| 3   | High contrast, with a query result and a syntax-highlighted console visible                                                                    | SQLite            | Pass. Canvas `#000000`, ink `#ffffff`, `color-scheme: dark`; the result grid, the highlighted `SELECT … ORDER BY` and Run's black ink on `#66b2ff` all legible; the file holds `highContrast`                                                                                          | `theme-high-contrast.png` |
| 4   | "Follow system" with the page emulating light, then dark: the app follows without reopening                                                    | SQLite            | Pass. With Follow system, `emulateMedia` light gives canvas `#ffffff`, dark `#1e1f22`, `contrast: more` `#000000`, back to no preference `#1e1f22`, with the dialog closed and nothing reopened                                                                                        | `theme-system.png`        |
| 5   | A seeded valid user theme is listed, chosen and applied; an invalid one is listed with its errors and cannot be chosen                         | SQLite            | Pass. `Solarized Dark` (base dark, canvas `#002b36`, panel `#073642`) applies with ink from its base, saved as `user:solarized`; `broken.json` is listed as disabled with `base` and `canvass` errors in red, a forced click leaves it unchecked and hovering it does not highlight it | `theme-user.png`          |
| 6   | Fonts: the editor family list shows monospace families first; a new editor family and size apply to the console, the grid's font stays its own | SQLite            | Pass. The editor family list groups the installed families as Monospace, then Proportional; Courier New at 16 px applies to the console while the grid cell stays 12 px in its own family                                                                                              | `fonts.png`               |
| 7   | Compact density: rows are 20 px; scrolling a 5,000-row result to the end shows the last row number in the right place                          | PostgreSQL        | Pass. `--tc-row-height` 20 px; Fetch All reads `5,000 rows`; scrolled to the end, the `5000` cell is 20 px high, 20 px below `4999` and inside the grid; Database rows are 20 px too                                                                                                   | `density-compact.png`     |
| 8   | `⌘=` twice, `⌘-` once, `⌘0`: the editor font grows, shrinks, resets; `⌘-` in the Database pane still collapses the tree                        | SQLite            | Pass. The editor font goes 13 → 14 → 15 (saved `sizePx: 15`) → 14 → 13; `⌘-` with focus in the Database pane collapses every expanded node and leaves the editor at 13                                                                                                                 | `editor-zoom.png`         |
| 9   | NULL text `∅` and digit grouping: the grid shows `∅` and `1,234,567`; Copy gives `1234567` and an empty NULL as before                         | PostgreSQL        | Pass. `SELECT 1234567 AS n, NULL::text AS v, -1234.5 AS d` draws `1,234,567`, `∅`, `-1,234.5`; Copy of the row gives `n,v,d\n1234567,,-1234.5\n`                                                                                                                                       | `data-formats.png`        |
| 10  | Page size 100: a 5,000-row query shows `100+ rows`; Fetch Next Page adds 100; a MySQL table editor page holds 100                              | PostgreSQL, MySQL | Pass. PostgreSQL: 5,000 rows shows `100+ rows`, Fetch Next Page `200+ rows`. Relaunched on MySQL, F4 on the 250-row `page_probe` opens the table editor at `100+ rows`, and Services reads `Load rows 100 rows`                                                                        | `page-size.png`           |
| 11  | Relaunch keeps theme, fonts, density and formats; the window's first frame is the theme's canvas                                               | SQLite            | Pass. After Light, Compact, editor 16 px and NULL `∅`, a relaunch paints the window `#FFFFFF` before the renderer loads, stays light under emulated dark, keeps 20 px rows and the 16 px editor, and draws `∅`                                                                         | `settings-persist.png`    |
| 12  | A corrupt `settings.json` is set aside as `.corrupt-<ms>` with a notice, and the app opens with defaults                                       | SQLite            | Pass. A truncated `settings.json` becomes one `settings.json.corrupt-<ms>`; the Database pane shows `settings.json could not be read (not JSON: …). It was moved to …` with Settings… and Dismiss under it; rows are 24 px and the theme follows the system                            | `settings-corrupt.png`    |

Bugs found while testing are fixed with a regression test and listed under Deviations.

---

## Deviations taken while implementing

**1. Six Dark tokens changed to pass the contrast test** (decision 9). `inkMuted` `#9da0a8` →
`#a6a9b1` (4.28 → 4.77 on `raised`); `danger` `#f75464` → `#fa6675` (4.21 → 4.75 on `panel`);
`gridNull` `#7c7f87` → `#868a91` and `syntax.comment` `#7a7e85` → `#868a91` (4.11 and 4.04 → 4.75
on `canvas`); `accent` `#3574f0` → `#78a6fb` and `accentInk` `#ffffff` → `#1e1f22`. `accent` is
both text (links, selected items, 3.85 on `canvas`, 2.62 on `raised`) and the primary button's fill
under `accentInk` (4.28), and no blue reaches 4.5:1 for text on `#393b40` and for white on itself,
so Dark's accent is now a light blue (4.61 on `raised`) with dark ink on it (6.79). The danger
button, `accentInk` on `danger`, goes from 3.28 to 5.67.

**2. The contrast pairs.** `syntax.bracketMatch` is a background, so the test measures `ink` on it
rather than it on `canvas`. Three pairs were added: `ink` on `gridSelection` (selected cells),
and as non-text `keyIcon` on `panel` and `planBar` on `canvas`. High contrast's non-text pairs need
4.5:1 like its other text. The 25 pairs and their ratios are in `docs/design/design-system.md`.

**3. `queryLocalFonts()` needs no permission handler.** In Electron 43 the call resolved with 572
faces with no `setPermissionRequestHandler`, so main grants nothing (decision 10's fallback was not
needed). The free-text field remains for a refusal or an empty list.

**4. Playwright's Electron page reports `prefers-color-scheme: light`** whatever the OS says, while
main's `nativeTheme.shouldUseDarkColors` follows macOS. With Follow system, the app under test is
light while main paints the first frame from the OS's dark; a real launch has no such split,
because Chromium's media query follows `nativeTheme`. The live tests set `emulateMedia` before
asserting a system-following theme, and row 11 checks the first frame on an explicit Light.
`emulateMedia({ contrast: "more" })` works and fires the media query's `change`.

**5. A result keeps the paging it ran with.** `ResultTab` carries `paging`, which Fetch Next Page,
Fetch All and the toolbar's `fetch cap reached` text read, rather than the current settings
(decision 14 said the texts read the settings). A changed page size therefore applies to the next
statement, as the decision intends, and an open result's Fetch Next Page still adds its own page.

**6. Digit grouping by type class.** The wire's `bigint` is a value kind under the `integer` type
class, so grouping applies to the `integer`, `decimal` and `float` classes and `bigint` values come
with `integer`; the text test decides, as decision 13 says.

**7. `settings.write` is validated by the field reader.** Main accepts a document only when
`readSettings` gives it back unchanged, so the renderer, main and the file share one definition of
a valid document instead of a zod schema mirroring `settings/settings.ts`. The page size is also
refused above the Fetch All limit in the dialog, so the pair cannot be saved inconsistent from
either side.

**8. Bug: two quick changes could interleave their saves.** Each `writeAtomically` writes
`settings.json.tmp`, so two settings changes in flight (typing a size) could rename a half-written
file. Main now chains writes one after another, a failed one not blocking the next
(`test/desktop/settings.test.ts`).

**9. Bug: a broken user theme still highlighted on hover**, from conflicting `hover:` classes on
its row. Row 5 hovers it and asserts its background stays the dialog's.

**10. Bug: the settings notice squeezed its text.** Settings… and Dismiss sat in a column beside a
long set-aside path, wrapping it a few characters wide. They now sit in a row under the text; row
12 asserts Dismiss is below the message.

**11. The macOS app menu's entries carry a platform.** `preload/menu.ts`'s `macOnly` became
`only: "mac" | "notMac"` on any entry, and `menuFor(mac)` filters the tree, so the explicit app
menu and File → Settings… are one declaration (`test/renderer/menu.test.ts` checks both).

**12. Refused values are marked.** A dialog input with `aria-invalid` now has a `border-danger`
frame (`dialogs/parts.tsx`), besides its inline message.

**13. Known, not changed:** after Fetch All, the Services execution row still reads the first
page's row count (`500 rows` for a 5,000-row result), as before this plan.

---

## Out of scope

- **Keymap editing.** Plan 003 deferred a user-editable keymap to this plan
  (`docs/plans/003-app-shell-and-action-registry.md:233-234`), but decision 014's v1 list does not
  name it; it waits for decision 014 to be amended. Find Action already lists every chord.
- **Date and time formats** (decision 032), per-datasource formats, boolean display, locale digit
  separators.
- Font ligatures, line height, per-tab zoom, grid zoom separate from the grid font size.
- Watching the themes folder; theme editing inside the app; themes that change fonts or density.
- Importing DataGrip or VS Code themes or settings.
- Moving the extractor and value panel out of the layout.
