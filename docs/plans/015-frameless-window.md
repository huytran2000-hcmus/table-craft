# Plan: Draw the title bar as DataGrip's main toolbar

Status: done. The window has no system title bar: the renderer's main toolbar is the title bar, 40 px
(32 compact), tinted `panel`, a drag region whose controls are not. On macOS the traffic lights sit
in it, centred by `trafficLightPosition` and re-centred when the density changes; on Windows and
Linux the native caption buttons are a `titleBarOverlay` recoloured from the theme, the toolbar
stops before them, and the hidden menu bar opens from a Main Menu button or Alt pressed alone. The
toolbar carries the datasource widget (switch to a datasource's console or open one), the active
tab's title (also the window title), Run, Cancel, Commit and Rollback, Search Everywhere and
Settings, every one an action. "Use system title bar" in Settings → Appearance brings the framed
window back after Restart Now. The live test drives all of it on macOS, checks the traffic lights
in a `screencapture` of the window, and the packaged suite checks the overlay and the menu button
on Windows and Linux in CI.

## The issue

The window still wears the operating system's title bar: a 28 px strip on macOS that says
"table-craft" and nothing else, and on Windows and Linux a caption plus a menu bar above the app.
DataGrip's New UI (2025.3, the target per `datagrip-inventory.md:1171`) has no such strip. Its
header _is_ the main toolbar (`datagrip-inventory.md:25`, "Main toolbar/header … project controls,
search, run controls", P0; §1.4 "integrated header", line 84): the traffic lights or the window
buttons sit in it, the main menu is a button on Windows and Linux (line 26), and the controls a
user reaches for most live there.

Today the window is created with only a title and a size (`packages/desktop/src/main/main.ts:170-190`;
`title: APP_NAME` at 172). Nothing sets `titleBarStyle`, `titleBarOverlay`, a drag region
(`-webkit-app-region` appears nowhere), full-screen handling or `setTitle`; the page's own
`<title>table-craft</title>` (`renderer/index.html:9`) never changes, so every window is called
"table-craft" in Mission Control and the taskbar. The shell's first row is the content itself
(`renderer/shell/Shell.tsx:35-36`); the run controls exist only inside each console
(`console/Console.tsx:33-60`); Search Everywhere and Settings have no button at all.

Decision 034 records the shape. This plan builds it.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Chrome per platform.** macOS: `titleBarStyle: "hiddenInset"`, `trafficLightPosition` that centres the lights vertically in the toolbar. Windows and Linux: `titleBarStyle: "hidden"` and `titleBarOverlay: { color, symbolColor, height }`. With the setting of decision 12 on, none of these is passed and the window is framed as today.                                                                                                                                                                                                                                                                                                  |
| 2   | **One pure builder in main.** New `main/chrome.ts` exports `windowChrome({ platform, theme, density, systemTitleBar })` returning the `BrowserWindow` options of decision 1 plus `overlay` and `trafficLights` for live updates. `createWindow` (`main.ts:170`) spreads it; `applyNativeTheme` (`main.ts:152-168`, renamed `applyWindowAppearance`) calls `setTitleBarOverlay` (Windows/Linux) and `setWindowButtonPosition` (macOS) beside `setBackgroundColor` (`main.ts:166`).                                                                                                                                                             |
| 3   | **Height is a density token.** `DensityTokens` gains `titleBarHeightPx`: 40 comfortable, 32 compact (DataGrip's main toolbar and its compact mode). `trafficLightInsetPx` (the width the lights occupy plus their margin, 76) is a density-independent constant beside it. Both reach CSS as `--tc-title-bar-height` and `--tc-traffic-light-inset` (`renderer/appearance/apply.ts:48-50` pattern) and Tailwind as `h-title-bar` / `pl-traffic-lights`.                                                                                                                                                                                       |
| 4   | **Overlay colours are tokens.** `color` = the theme's `panel`, `symbolColor` = `ink`, so the system buttons sit on the toolbar's own background in Dark, Light, High contrast and user themes; switching theme or density updates them live. The overlay height is `titleBarHeightPx`.                                                                                                                                                                                                                                                                                                                                                        |
| 5   | **Layout of the toolbar** (`role="toolbar"`, `aria-label="Main toolbar"`, `bg-panel`, `border-b border-line`), left to right: the traffic-light inset (macOS, not in full screen) or the main-menu button (Windows/Linux); the datasource widget; the window title, centred and muted, truncating; the run widget (Run, Cancel, Commit, Rollback, icon-only with tooltips); Search Everywhere; Settings. On Windows/Linux the toolbar ends at `env(titlebar-area-width)` so nothing sits under the system buttons.                                                                                                                            |
| 6   | **It is a drag region.** The toolbar is `app-region: drag` and `user-select: none`; every button, the widget and its popover are `app-region: no-drag`. Two utilities in `app.css` (`.app-drag`, `.app-no-drag`) are the only spelling; `ui/` controls used in the toolbar take `no-drag`. Double-click on empty toolbar space is left to the system (zoom on macOS per the user's Dock preference, maximise on Windows/Linux); the live test verifies it.                                                                                                                                                                                    |
| 7   | **Toolbar buttons are views over actions.** Run (`console.run`), Cancel (`console.cancel`), Commit (`transaction.commit`), Rollback (`transaction.rollback`), Search Everywhere (`palette.searchEverywhere`), Settings (`settings.show`) render through `console/ActionButton.tsx` (moved to `ui/ActionButton.tsx`, its `compact` mode), so enabled state, tooltip and chord come from the registry (decision 015). They act on the active tab exactly as the chords do (`actions/context.ts:107-148`). A button hidden by `available` (no `cancel`, no `transactions`) is not drawn.                                                         |
| 8   | **Toolbar buttons do not take focus from the mouse.** `onMouseDown` prevents default, so clicking Run leaves the caret in the editor and the focus region unchanged (`actions/context.ts:30`); Tab still reaches them.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 9   | **The datasource widget** (DataGrip's project widget): the active datasource's tint swatch, name and status dot — the same datasource the status bar shows (`shell/statusItems.tsx:38-44`) — or "No data source". Click opens a Radix popover listing every datasource (swatch, name, connected/disconnected); choosing one invokes new action `datasource.switchTo { datasourceId }`, which activates that datasource's most recently active console or table tab, else opens a new console on it. The list ends with New Data Source… (`datasource.new`) and Data Sources… (`datasource.properties`).                                       |
| 10  | **Window title.** New pure `model/windowTitle.ts`: `windowTitle(activeTab, datasourceName) → "console [pg] — table-craft"`, or `"table-craft"` with no tab. The renderer writes it to `document.title` (Electron mirrors it to the window, so Mission Control, the Dock menu and the taskbar read it) and shows the tab part in the toolbar.                                                                                                                                                                                                                                                                                                  |
| 11  | **Main menu on Windows and Linux.** New action `app.mainMenu` ("Main Menu", icon `menu`, no chord, available when the platform is not macOS and the system title bar is off) invokes bridge `menu.popup({ x, y })` with the button's bottom-left; main pops `Menu.getApplicationMenu()` at that point in the sender's window. Main also pops it, at the button's position, when Alt is pressed and released with no other key between (a small `loneAlt` state machine on `before-input-event`); Alt chords and AltGr typing are untouched. The window's menu bar is hidden (`setMenuBarVisibility(false)`) while the custom title bar is on. |
| 12  | **Escape hatch.** `settings.appearance.systemTitleBar: boolean`, default `false`, shown as Appearance → "Use system title bar" with "Takes effect after restart" and a Restart Now button (new action `app.relaunch`, which goes through the close guard of decision 024 and then `app.relaunch()`). Main reads it once, at window creation. With it on, the main toolbar still shows, but without the inset, the menu button or the drag region, and Windows/Linux get their menu bar back.                                                                                                                                                  |
| 13  | **Full screen on macOS.** Main sends `CHANNELS.windowState { fullScreen }` on `enter-full-screen` / `leave-full-screen` and answers `window.state` on request at startup; the renderer drops the traffic-light inset while full screen.                                                                                                                                                                                                                                                                                                                                                                                                       |
| 14  | **Nothing else moves.** The console toolbar, tool-window stripes, editor tabs and status bar stay as they are; the toolbar adds `titleBarHeightPx` above them and the content shrinks by that much. `EVIDENCE_WINDOW` (1200×800) stays the window's content size, which on a hidden title bar is the whole window.                                                                                                                                                                                                                                                                                                                            |
| 15  | **Tests find buttons by toolbar.** The console toolbar gains `role="toolbar"` `aria-label="Console toolbar"`. `harness.ts` `runButton`, `runAllButton`, `cancelButton` (191-207) and any Commit/Rollback lookups scope to it; new helpers `mainToolbar(page)` and `mainToolbarButton(page, name)` find the other one.                                                                                                                                                                                                                                                                                                                         |

### Consequences worth naming

**This is a behaviour change.** The OS title bar disappears on every platform, and on Windows and
Linux so does the menu bar; the menu moves behind a button and Alt. A user whose window manager
draws the overlay badly turns on "Use system title bar" and restarts.

**This crosses the fence, but not the engine's.** Main ↔ renderer gains invoke channels
`menu.popup` and `window.state` and the push channel `windowState`, plus `app.relaunch`. The engine
protocol is untouched, and so is the plugin contract.

**These defaults were chosen without asking.** Toolbar heights 40/32 px, the overlay coloured as
`panel`/`ink`, the title centred, and the datasource widget switching to the most recent tab rather
than filtering the tabs. Decision 014's v1 list gains "frameless window with a main toolbar" under
the app shell.

**Evidence shows web contents.** `page.screenshot` cannot see the traffic lights or the overlay
buttons. One live-test row captures the whole window on macOS with `screencapture`; Windows and
Linux are asserted geometrically in CI.

---

## Phase 0 — Tokens, the chrome builder and the setting

- `src/appearance/themes.ts`: `DensityTokens.titleBarHeightPx` (comfortable 40, compact 32) and
  `TRAFFIC_LIGHT_INSET_PX = 76`. `renderer/appearance/apply.ts` writes `--tc-title-bar-height`,
  `--tc-traffic-light-inset`; `renderer/app.css` maps `--spacing-title-bar`,
  `--spacing-traffic-lights` and adds `.app-drag { app-region: drag; -webkit-app-region: drag;
user-select: none }` and `.app-no-drag { app-region: no-drag; -webkit-app-region: no-drag }`.
- `src/settings/settings.ts`: `AppearanceSettings.systemTitleBar: boolean`, default `false`, read
  field by field like the rest (an unreadable value falls back to the default).
- New `main/chrome.ts`:

```ts
export interface WindowChrome {
  readonly options: Pick<BrowserWindowConstructorOptions, "titleBarStyle" | "titleBarOverlay" | "trafficLightPosition">;
  readonly overlay: TitleBarOverlayOptions | null; // Windows/Linux live update
  readonly trafficLights: Point | null; // macOS live update
}
export function windowChrome(input: {
  platform: NodeJS.Platform;
  theme: Theme;
  density: DensityTokens;
  systemTitleBar: boolean;
}): WindowChrome;
```

| Input                          | Result                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| darwin, custom                 | `hiddenInset`, lights at `{ x: 12, y: (height − 14) / 2 }`, no overlay                |
| win32 / linux, custom          | `hidden`, overlay `{ color: panel, symbolColor: ink, height }`                        |
| any, `systemTitleBar`          | `{}` — framed window, no overlay, no light position                                   |
| theme or density changes, live | `overlay` / `trafficLights` re-derived; options other than those two are never reused |

## Phase 1 — Main: window, menu popup, full screen, relaunch

- `main.ts` `createWindow` spreads `windowChrome(...).options`; `applyWindowAppearance` (renamed
  from `applyNativeTheme`) also calls `setTitleBarOverlay` / `setWindowButtonPosition` when the
  window was created custom. On Windows/Linux with the custom title bar, `setMenuBarVisibility(false)`.
- `main/menuPopup.ts`: `popupApplicationMenu(window, point)` and `createLoneAlt()`:

```ts
export function createLoneAlt(): { input(event: { type: "keyDown" | "keyUp"; key: string }): boolean };
```

returns `true` on the keyUp that completes Alt-alone. Wired on `webContents.on("before-input-event")`
for non-mac custom windows; a `true` pops the menu at `MENU_BUTTON_ANCHOR` (left edge, under the
toolbar).

- `preload/bridge.ts` `INVOKE_CHANNELS` gains `popupMenu`, `windowState`, `relaunch`; `CHANNELS`
  gains `windowState`. `ipc.ts` handlers with zod requests (`{ x: int ≥ 0, y: int ≥ 0 }`).
  `relaunch` runs the close guard's flush (decision 024) then `app.relaunch(); app.quit()`.
- Full screen: `enter-full-screen` / `leave-full-screen` broadcast `windowState`.

## Phase 2 — Renderer: the main toolbar

| File                         | Responsibility                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `shell/MainToolbar.tsx`      | The toolbar of decision 5; first child of `<main>` in `Shell.tsx:35`               |
| `shell/DatasourceWidget.tsx` | Decision 9, Radix popover, `no-drag`                                               |
| `ui/ActionButton.tsx`        | Moved from `console/`; gains `onMouseDown` preventDefault (decision 8)             |
| `model/windowTitle.ts`       | Decision 10, pure                                                                  |
| `state/windowState.ts`       | `{ fullScreen, customTitleBar }` from `window.state` and the `windowState` channel |
| `actions/windowActions.ts`   | `app.mainMenu`, `app.relaunch`, `datasource.switchTo`                              |
| `dialogs/Settings.tsx`       | "Use system title bar" switch, restart note, Restart Now                           |
| `console/Console.tsx`        | Toolbar gets `role="toolbar"` `aria-label="Console toolbar"`                       |

- `ActionIcon` (`actions/registry.ts:18-63`) gains `menu`; `ui/icons.ts` gets the glyph.
- The keymap test (`test/renderer/keymap.test.ts`) runs over the three new actions; none has a
  chord.

## Phase 3 — Fixtures, tests, docs

No fixture schema changes.

Harness (`test/e2e/harness.ts`): scope `runButton`/`runAllButton`/`cancelButton` to the console
toolbar; add `mainToolbar`, `mainToolbarButton`, `windowTitle(app)` (`getTitle()` of the first
window); fix the `contentSize` comment (182), which says it excludes a title bar.

New unit tests:

- `test/desktop/chrome.test.ts`: `givenMac_whenChromeBuilt_thenHiddenInsetWithCentredLights`,
  `givenWindows_whenChromeBuilt_thenOverlayUsesPanelAndInk`,
  `givenCompactDensity_whenChromeBuilt_thenOverlayIs32High`,
  `givenSystemTitleBar_whenChromeBuilt_thenNoChromeOptions`,
  `givenUserTheme_whenChromeBuilt_thenOverlayTakesItsPanel`.
- `test/desktop/menuPopup.test.ts`: `givenAltAlone_whenReleased_thenPopsMenu`,
  `givenAltF_whenReleased_thenDoesNotPop`, `givenAltHeldWithShift_whenReleased_thenDoesNotPop`.
- `test/renderer/windowTitle.test.ts`: `givenConsoleTab_whenTitled_thenTabThenAppName`,
  `givenNoTab_whenTitled_thenAppNameAlone`.
- `test/renderer/switchTo.test.ts`: `givenOpenConsoleOnDatasource_whenSwitchTo_thenActivatesIt`,
  `givenNoTabOnDatasource_whenSwitchTo_thenOpensConsole`.
- `test/desktop/settings.test.ts` gains `givenNoSystemTitleBarField_whenRead_thenFalse`.

New smoke suite `test/e2e/titleBar.smoke.test.ts` (`evidenceFor("015")`); the packaged suite gains
a non-mac assertion that the main-menu button is visible and the toolbar ends before the overlay
(`env(titlebar-area-width)` narrower than the window), which runs on the Windows and Linux CI jobs.

Docs: `specification.md` "Shell and actions" gains "Window and main toolbar" (decisions 1–15), drops
the stale "(decision 010)" after "One window" (389), and the native-menu paragraph (494-504) says
Windows/Linux reach it through the main-menu button and Alt; "Settings and appearance" lists the
new switch. `design-system.md` "Shell tokens" gains the title-bar height, inset, toolbar spacing and
overlay colours. Decision 014's v1 list gains the frameless window. AGENTS.md layout mentions
`main/chrome.ts` and `shell/MainToolbar.tsx`.

Every phase ends with `bun run typecheck` and `bun run test` green.

---

## Live test

Suite `test/e2e/titleBar.smoke.test.ts`, run with
`TABLE_CRAFT_EVIDENCE_DIR=docs/evidence/015 bun run test:smoke:db`, window 1200×800.

| #   | Scenario                                                                                                                                              | Database | Result                                                                                                                                                                                                                                                 | Evidence                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| 1   | Launch: toolbar at top, inset for the lights, title "table-craft", no OS title bar                                                                    | sqlite   | Pass. The toolbar is the first 40 px of a 1200×800 content area that is the whole window (outer minus inner height 0); 76 px left inset, no Main Menu button on macOS; the launch console makes the title "console [lite] — table-craft" (deviation 9) | `docs/evidence/015/toolbar.png`                                                        |
| 2   | Whole window captured with `screencapture`: traffic lights centred in the toolbar                                                                     | sqlite   | Pass. `getWindowButtonPosition()` is {12, 13}; in `screencapture -l<window>` the close button's rows centre within 1.5 px of the bar's middle (20 px)                                                                                                  | `docs/evidence/015/chrome-macos.png`                                                   |
| 3   | Open a console: window title "console [pg] — table-craft", widget shows pg                                                                            | postgres | Pass. `BrowserWindow.getTitle()` and the toolbar caption follow the active tab; the widget names pg with its status dot                                                                                                                                | `docs/evidence/015/title.png`                                                          |
| 4   | Datasource widget popover lists all three; choosing MySQL activates its console                                                                       | all      | Pass. The popover lists pg and mysql connected, sqlite disconnected, then New Data Source… and Data Sources…; choosing mysql activates its console (still two tabs), choosing sqlite opens "console [sqlite]"                                          | `docs/evidence/015/widget.png`                                                         |
| 5   | Run from the toolbar with the caret in the editor; caret stays, grid shows                                                                            | postgres | Pass. The grid shows the row and focus stays in the editor                                                                                                                                                                                             | `docs/evidence/015/run.png`                                                            |
| 6   | `SELECT pg_sleep(30)`, Cancel from the toolbar                                                                                                        | postgres | Pass. "The statement was cancelled." within 10 s                                                                                                                                                                                                       | `docs/evidence/015/cancel.png`                                                         |
| 7   | Manual mode, UPDATE, Rollback from the toolbar; row unchanged                                                                                         | mysql    | Pass. Commit and Rollback enable once the UPDATE opens the transaction; after Rollback the total reads as before                                                                                                                                       | `docs/evidence/015/rollback.png`                                                       |
| 8   | Search Everywhere and Settings buttons open the palette and the dialog                                                                                | sqlite   | Pass. Search Everywhere opens the palette; Settings… opens the dialog, whose Appearance page shows "Use system title bar" unchecked                                                                                                                    | `docs/evidence/015/settings.png`                                                       |
| 9   | Light theme, then compact density: toolbar recolours and is 32 px, lights stay centred                                                                | sqlite   | Pass. The toolbar goes from Dark `panel` rgb(43, 45, 48) to Light rgb(247, 248, 250) and from 40 to 32 px; the lights move to {12, 9} and stay centred in the native capture                                                                           | `docs/evidence/015/compact-light.png`, `docs/evidence/015/compact-light-native.png`    |
| 10  | Full screen: inset gone; leaving restores it                                                                                                          | sqlite   | Pass. In full screen the toolbar's left padding is the 8 px gap; after leaving it is 76 px again                                                                                                                                                       | `docs/evidence/015/fullscreen.png`                                                     |
| 11  | Drag region: computed `app-region` drag on the toolbar, no-drag on each control; double-click on empty toolbar zooms the window (`isMaximized` flips) | sqlite   | Pass, drag region only. The toolbar computes `drag`; the widget, Run, Search Everywhere and Settings… compute `no-drag`. The double-click is not driven (deviation 1)                                                                                  | —                                                                                      |
| 12  | "Use system title bar" + Restart Now: relaunches framed, no inset, no drag region, setting kept                                                       | sqlite   | Pass. Restart Now quits through the close guard and relaunches; the new process has a 32 px macOS title bar, no drag region, an 8 px left padding, no Main Menu button, and `systemTitleBar` still true                                                | `docs/evidence/015/system-title.png`, `docs/evidence/015/system-title-native.png`      |
| 13  | Packaged suite on Windows and Linux CI: main-menu button visible, toolbar ends before the overlay                                                     | sqlite   | Pass. Windows x64 and Linux x64: Main Menu visible, `windowControlsOverlay` visible with a title bar area narrower than the window, Settings… ends inside it, menu bar hidden; macOS arm64 and x64: lights at {12, 13}, no Main Menu                   | [run 39780893917](https://github.com/tranphucbol/table-craft/actions/runs/39780893917) |

---

## Deviations taken while implementing

**1. The double-click zoom is left to the system and not driven.** Row 11 asked for a double-click
on the empty toolbar to flip `isMaximized`. Playwright's double-click travels over CDP into the web
contents and never reaches the `NSWindow`, so it does not zoom; an OS-level double-click
(`cliclick`, or `CGEvent` posted to the process or the HID tap) is refused on this host without the
Accessibility permission. The suite asserts the computed `app-region` instead; the zoom stays the
system's (`AppleActionOnDoubleClick` is Maximize here), as decision 6 intended.

**2. Lone Alt is proved below the window, not through it.** `before-input-event` does not see the
keys Playwright sends over CDP; it does see `webContents.sendInputEvent` (probed live on Electron
43.8.3, where the Alt key-down itself arrives with `alt: false`). The state machine is pure and
unit-tested (`test/desktop/menuPopup.test.ts`), with two cases beyond the plan:
`givenAChordBefore_whenAltPressedAloneAfter_thenPops` and
`givenAKeyHeldWhenFocusLeft_whenReset_thenAltAloneStillPops` (the watcher resets on blur so a key
released in another window cannot leave it disarmed).

**3. Restart Now relaunches from `will-quit`.** Decision 12 said `app.relaunch(); app.quit()`.
Calling `app.relaunch()` first would relaunch even if the close guard is refused (an unsaved console
the user decides to keep), because the relaunch is registered on exit. Main now sets a flag, quits
through the close guard, clears the flag if the renderer answers "don't close", and calls
`app.relaunch()` in `will-quit` after the hosts close.

**4. `popupApplicationMenu` takes the menu.** Its signature is `(menu, window, point)`, the caller
passing `Menu.getApplicationMenu()`, so `main/menuPopup.ts` imports only Electron types and its
tests need no Electron.

**5. Cancel, Commit and Rollback gained `available`.** Decision 7 assumed these actions already
declared availability; they had only `when`. Cancel is now available with the `cancel` capability,
Commit and Rollback with `transactions`, so with SQLite or no tab the main toolbar does not draw them
and the palette does not list them.

**6. The widget's popover is "Switch data source".** Named "Data sources", it matched the harness's
`getByRole("dialog", { name: "Data Sources" })`, which is case-insensitive and not exact, so a
Data Sources dialog opened from the popover's last row would have had two matches.

**7. The overlay inset is right padding.** Decision 5 had the toolbar end at
`env(titlebar-area-width)`. A width would also need the `titlebar-area-x` offset and fight the flex
column it sits in; `.title-bar-overlay-inset` pads the right side by the width the caption buttons
take, `100vw − titlebar-area-x − titlebar-area-width`, plus the gap. The packaged suite checks the
result: Settings… ends inside the title bar area on Windows and Linux.

**8. "Most recently active" needed a recency list.** `switchTo` activates a datasource's most
recently active tab; the tab store kept only the active id, so it gains `recent` (most recent first,
closed tabs dropped), covered by `givenTabsActivatedInTurn_whenRecencyRead_thenMostRecentFirstAndClosedGone`.

**9. Row 1's title is the launch console's.** The harness launches with a console open, so the
first title is "console [lite] — table-craft"; "table-craft" alone is covered by
`givenNoTab_whenTitled_thenAppNameAlone`.

**10. The relaunch is followed over CDP.** A relaunched process is not Playwright's. Electron keeps
`--remote-debugging-port=0` in the relaunch arguments, so the new process writes
`<userData>/DevToolsActivePort`; row 12 deletes the old file, waits for the first process to exit,
connects with `chromium.connectOverCDP` and stops the process itself afterwards. The scenario seeds
the Light theme so the system-drawn title bar (following the host's appearance otherwise, Dark here)
matches the page Playwright renders light.

**11. Page screenshots cannot show the native controls.** As decision 034 says, `page.screenshot`
captures the web contents, so the traffic lights are an empty inset in every evidence PNG but
`chrome-macos.png`. Rows 9 and 12 add `compact-light-native.png` (a window capture) and
`system-title-native.png` (a screen capture of the window bounds, resampled to 1200 wide) to show
them. Screen recording is permitted on this host; without it the pixel check would be skipped and
the geometric check (`getWindowButtonPosition`) stand alone.

**12. The macOS title bar is 32 px, the lights 14 px.** Measured on macOS 27 with Electron 43.8.3:
the framed window's outer height exceeds the inner by 32 px (row 12 asserts at least 28), and the
close button spans 14 px in a window capture, the height `main/chrome.ts` centres with
`(titleBarHeightPx − 14) / 2`.

---

## Out of scope

- Custom-drawn window controls: decision 034 keeps the native ones.
- Tool-window buttons in the header (DataGrip can put the stripe there): the stripes stay.
- Persisting window bounds and maximised state across launches: every launch is still 1200×800.
- Islands styling of the panes below the toolbar: a theme concern, not chrome.
- A run-configuration widget: the run widget is the console's run controls, nothing more.
- A Windows/Linux main menu drawn in HTML: the native menu pops up instead.
