# Plan: Build the DataGrip-shaped shell on one action registry

Status: done. The window is now DataGrip's shell: Database on the left, editor tabs in the middle,
Services at the bottom, an empty right stripe and a status bar, laid out with
`react-resizable-panels` and remembered across launches. Fourteen actions live in one registry, and
the buttons, the keymap, the tab context menu, Find Action / Search Everywhere and the native menu
all run them through the same `invoke`. Each console tab owns its own engine session, and closing
the tab sends the new `session.close`. All nine live-test rows passed against PostgreSQL, MySQL and
SQLite on the first run of the finished scenarios; looking at the screenshots found no bug, but it
showed that a datasource whose connect fails is drawn as "Datasource", because the renderer only
learns the plugin name from a successful `session.open` (left for plan 004). Reality differed in
where renderer tests live (`test/renderer/`, a third typecheck program), in a profile-directory
seam for the smoke runs, and in tab cycling being "select next", as DataGrip does, rather than
reordering.

## The issue

The window is one console stacked on one grid (`packages/desktop/src/renderer/App.tsx:12-17`).
There is nowhere to put the database explorer (plan 005), the Services window (plan 011), more than
one console, or a status line, and every command is wired straight into a component: `Run` is an
`onClick` (`renderer/console/Console.tsx:35-42`), `Cancel` another (`Console.tsx:43-52`), and
`⌘↵` is a hand-rolled `onKeyDown` on the textarea (`Console.tsx:18-22`). Main builds no menu at all
(`main/main.ts:30-45`), so the app has Electron's default one.

Every later plan adds buttons. If they keep landing as `onClick`s, Find Action, Search Everywhere,
the keymap and the menus each need their own copy of every command, which is what decision 015
exists to prevent. This plan lays the shell and the registry once, so plans 004–014 only add
actions and panes.

The driving case is the screenshot DataGrip users know (`docs/design/datagrip-inventory.md` §1):
Database tool window on the left, editor tabs in the middle, Services at the bottom, a status bar,
`⌘1` / `⌘8` toggling the tool windows, `⌘⇧A` finding any action, `⇧⇧` searching everything.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The registry lives in `renderer/actions/`. An action is `{ id, title, category, icon?, shortcut?, when?, run }`. `when(context)` decides enabled; `run(context, args?)` does the work. `invoke(id, args?)` is the only way anything runs a command (decision 015)                                                                                                                                                   |
| 2   | `ActionContext` is a plain snapshot computed from the stores at invoke time: active tab and its kind, the active console's status and capabilities, which region has focus, tool-window visibility. Actions read context; they never reach into components                                                                                                                                                          |
| 3   | Shortcuts are declared on the action as chords in a platform-neutral form (`"Mod+Shift+A"`, `"Shift Shift"` for double-tap). `Mod` is `⌘` on macOS and `Ctrl` elsewhere. One `window` keydown listener in the capture phase dispatches chords; a chord whose action is disabled falls through to the focused element                                                                                                |
| 4   | Two enabled actions may not share a chord. A unit test walks the registry and fails on a clash — the keymap is checked data, not convention                                                                                                                                                                                                                                                                         |
| 5   | Shortcuts are DataGrip's macOS defaults where one exists: run `Mod+Enter`, new console `Mod+Shift+L`, close tab `Mod+W`, next/previous tab `Mod+Shift+]` / `Mod+Shift+[`, Database `Mod+1`, Services `Mod+8`, hide all tool windows `Mod+Shift+F12`, Find Action `Mod+Shift+A`, Search Everywhere `Shift Shift`, back to editor `Escape` — matches muscle memory                                                    |
| 6   | Find Action and Search Everywhere are one palette component with two modes. Search Everywhere has tabs (`All`, `Actions` now; plan 005 adds `Tables`) fed by `SearchProvider`s: `{ id, title, search(query): readonly SearchItem[] }`. Disabled actions show greyed with their shortcut and cannot be run — DataGrip shows them too, and seeing why nothing happens beats a missing row                             |
| 7   | Matching is a small in-house fuzzy scorer (prefix of words > consecutive > scattered, recency boost), pure and unit-tested. No new dependency for forty lines                                                                                                                                                                                                                                                       |
| 8   | The native application menu is built in main from a declarations-only list, `preload/menu.ts`: `{ label, actionId, accelerator? }` per item plus role items (`editMenu`, `windowMenu`, `appMenu`). A click sends the action id on `table-craft:invoke-action`; preload relays it; the renderer calls `invoke`. Main never decides whether an action is enabled                                                      |
| 9   | One keypress runs a command once. The renderer keymap is the dispatcher for every chord. Menu items show their accelerator with `registerAccelerator: false` where Electron honours it (Windows, Linux); on macOS, if the menu's key equivalent consumes the keydown, the menu click is the dispatch path for that chord. Either way both paths reach the same `invoke`, and the live test asserts single execution |
| 10  | The layout is `react-resizable-panels`: left stripe + Database tool window, editor area, bottom Services tool window, right stripe reserved and empty, status bar. Stripe buttons are actions (`toolWindow.database.toggle`, …)                                                                                                                                                                                     |
| 11  | Layout state (which tool windows are open, their sizes) persists in renderer `localStorage` under `table-craft.layout.v1`. It is per-window UI memory, not a user preference; `settings.json` (decision 010) is for preferences and arrives with plan 013                                                                                                                                                           |
| 12  | Editor tabs are a Zustand store of `{ id, kind, title }` with kind `console` only for now. The strip supports activate, close, close others, close all (a Radix context menu whose items are actions), reorder by `Mod+Shift+[ / ]`. Closing the last tab shows an empty state that names `Mod+Shift+L`                                                                                                             |
| 13  | Each console tab owns its own engine session and result. `state/results.ts` becomes a store keyed by console id (one subscription surface per console, decision 003); the engine port stays one per window, sessions are many per port (decision 002). New console opens a session; closing the tab closes the session and releases its handle                                                                      |
| 14  | The Database tool window shows the current datasource as one node with its plugin name and connection state, and the Services tool window lists open consoles with idle / running / failed and the last statement's duration. Both are placeholders for plans 005 and 011, built on the panes those plans will fill                                                                                                 |
| 15  | The status bar shows the active datasource and its state on the left ("PostgreSQL · connected", the connect error's message when failed) and a running indicator on the right. Its slots are a small registry so later plans add items (caret position with CodeMirror, sync time with the explorer)                                                                                                                |
| 16  | New dependencies: `react-resizable-panels`, `@phosphor-icons/react`, `@radix-ui/react-dialog`, `@radix-ui/react-context-menu`, `@radix-ui/react-tooltip` — the versions `../preman` uses                                                                                                                                                                                                                            |
| 17  | The visible button labels `Run` and `Cancel` and the `SQL console` label stay, so `test/e2e/harness.ts` keeps working                                                                                                                                                                                                                                                                                               |

### Consequences worth naming

**This is a behaviour change.** `⌘↵` moves from the textarea's `onKeyDown` to the global keymap,
so it works from anywhere in a console tab, not only with the textarea focused. `Escape` from a tool
window now returns focus to the editor.

**This crosses the fence.** Main gains a menu and one IPC channel, `table-craft:invoke-action`
(main → renderer, payload an action id). `TableCraftBridge` gains `onInvokeAction(listener)`.
`engine/protocol.ts` gains `session.close` so a closed console frees its session.

**This changes the console store.** Every caller of `useResults` takes a console id. The e2e
harness only touches labels, so it is unaffected.

**This default was chosen without asking.** Layout persists per machine in `localStorage`, not in
`settings.json`; the shortcuts are DataGrip's macOS keymap, not VS Code's.

---

## Phase 0 — The registry, keymap and palette model (pure)

| File                           | Responsibility                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `renderer/actions/registry.ts` | `defineAction`, `registerActions`, `invoke`, `isEnabled`, `allActions`; duplicate id throws naming both            |
| `renderer/actions/context.ts`  | `ActionContext` and `currentContext()` from the stores                                                             |
| `renderer/actions/chords.ts`   | parse, normalise, format (`⌘⇧A` on macOS, `Ctrl+Shift+A` elsewhere), match a `KeyboardEvent`, double-tap detection |
| `renderer/actions/keymap.ts`   | the capture-phase listener; clash detection exported for the test                                                  |
| `renderer/model/fuzzy.ts`      | `score(query, text): number \| null`                                                                               |
| `renderer/model/palette.ts`    | mode, query, provider results merged and ranked, recent ids                                                        |

```ts
export interface Action<A = void> {
  readonly id: string;
  readonly title: string;
  readonly category: ActionCategory;
  readonly icon?: ActionIcon;
  readonly shortcut?: Chord;
  readonly when?: (context: ActionContext) => boolean;
  readonly run: (context: ActionContext, args: A) => void | Promise<void>;
}

export function invoke(id: string, args?: unknown): InvokeOutcome; // "ran" | "disabled" | "unknown"
```

```ts
const DOUBLE_TAP_WINDOW_MS = 300;
const RECENT_ACTIONS_LIMIT = 8;
const LAYOUT_STORAGE_KEY = "table-craft.layout.v1";
```

| Situation                                                | Result                                                                |
| -------------------------------------------------------- | --------------------------------------------------------------------- |
| Chord pressed, action enabled                            | action runs, event `preventDefault`ed                                 |
| Chord pressed, action disabled                           | nothing runs, event reaches the focused element                       |
| `Shift` then `Shift` within 300 ms, no other key between | Search Everywhere                                                     |
| `Shift`, `A`, `Shift`                                    | no double-tap                                                         |
| Palette open                                             | chords other than `Escape`, `Enter`, arrows pass to the palette input |

## Phase 1 — Shell layout, tabs, per-console sessions

- `renderer/shell/Shell.tsx`: stripes, panel group, status bar. `App.tsx` renders `Shell`.
- `renderer/shell/ToolWindow.tsx`, `Stripe.tsx`, `StatusBar.tsx` + `renderer/shell/statusItems.ts`.
- `renderer/state/layout.ts`: tool-window visibility and sizes, persisted.
- `renderer/state/tabs.ts`: tabs, active id, open / close / closeOthers / closeAll / move.
- `renderer/state/consoles.ts` replaces `state/results.ts`: keyed by console id, each with its own
  `sessionId`, status, error, result, windows. The port is connected once per window.
- `engine/protocol.ts` + `engine/engine.ts`: `session.close`, releasing the session's handles.
- `renderer/panes/DatabasePane.tsx`, `renderer/panes/ServicesPane.tsx`: the placeholders of
  decision 14.
- Actions: `console.run`, `console.cancel`, `console.new`, `tab.close`, `tab.closeOthers`,
  `tab.closeAll`, `tab.next`, `tab.previous`, `toolWindow.database.toggle`,
  `toolWindow.services.toggle`, `toolWindow.hideAll`, `focus.editor`. Console toolbar buttons and
  stripe buttons call `invoke`.

## Phase 2 — Palette, menus

- `renderer/palette/Palette.tsx`: Radix dialog, one input, tabbed results in Search Everywhere,
  shortcut shown right-aligned, greyed disabled rows. Actions `palette.findAction`,
  `palette.searchEverywhere`.
- `renderer/palette/providers.ts`: the actions provider; the `SearchProvider` interface exported
  for plan 005.
- `preload/menu.ts`: the menu declaration — File (New Console, Close Tab), Edit (role), View (Tool
  Windows ▸ Database, Services; Hide All Tool Windows; Find Action…; Search Everywhere), Window
  (role), Help (role). `main/menu.ts` builds it; `preload/bridge.ts` gains the channel and
  `onInvokeAction`.

## Phase 3 — Fixtures, tests, docs

New `test/desktop/actions.test.ts`, `chords.test.ts`, `keymap.test.ts`, `fuzzy.test.ts`,
`palette.test.ts`, `tabs.test.ts`, `layout.test.ts`, `menu.test.ts`; `test/desktop/engine.test.ts`
gains `session.close`.

New cases:

`givenTwoActionsWithSameId_whenRegistered_thenThrowsNamingBoth`,
`givenDisabledAction_whenInvoked_thenReturnsDisabledAndDoesNotRun`,
`givenUnknownId_whenInvoked_thenReturnsUnknown`,
`givenRegisteredActions_whenShortcutsCompared_thenNoTwoShareAChord`,
`givenModShiftA_whenFormattedOnMac_thenReadsCmdShiftA`,
`givenModShiftA_whenFormattedOnLinux_thenReadsCtrlShiftA`,
`givenShiftTwiceWithin300ms_whenDispatched_thenSearchEverywhereRuns`,
`givenShiftAThenShift_whenDispatched_thenNoDoubleTap`,
`givenChordForDisabledAction_whenPressed_thenEventNotPrevented`,
`givenQueryNc_whenScored_thenNewConsoleRanksAboveCancel`,
`givenRecentlyRunAction_whenPaletteOpensEmpty_thenItIsFirst`,
`givenThreeTabs_whenMiddleClosed_thenRightNeighbourBecomesActive`,
`givenLastTabClosed_whenRendered_thenNoActiveTab`,
`givenSavedLayout_whenLoaded_thenToolWindowsRestored`,
`givenCorruptLayoutJson_whenLoaded_thenDefaultsUsed`,
`givenMenuDeclaration_whenComparedWithRegistry_thenEveryActionIdExists`,
`givenOpenSession_whenClosed_thenItsHandlesAreReleased`.

E2E (`test/e2e/shell.smoke.test.ts`, SQLite, runs under `test:smoke`): shell renders with both tool
windows; `⌘1` hides and shows Database; `⌘⇧A`, type "new console", `Enter` opens a second tab.

Docs: `docs/design/specification.md` gains a "Shell and actions" section listing the action ids and
shortcuts; `docs/design/design-system.md` gains the stripe, tab and status-bar tokens it uses.

Every phase ends with `bun run typecheck` and `bun run test` both green.

---

## Live test

Run the built app with `TABLE_CRAFT_DATASOURCE` against the `test:db` Postgres unless the row says
otherwise, drive it with the harness in `test/e2e/harness.ts`, and save one PNG per row to
`docs/evidence/003/`. Capture at the window's full 1200×800 so the shell is visible.

| #   | Scenario                                                                                                                                                     | Database | Result                                                                                                                                                                                                                                                                     | Evidence                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 1   | Launch: Database left with the datasource node, editor with one console tab, Services bottom, status bar "PostgreSQL · connected"                            | postgres | Pass. Datasource node "PostgreSQL · connected", tab `console`, Services lists it idle, status bar "PostgreSQL · connected"                                                                                                                                                 | `shell-default.png`        |
| 2   | `⌘1` hides Database, `⌘8` hides Services, `⌘⇧F12` hides all, `⌘1` brings Database back — each toggles exactly once                                           | postgres | Pass. Each chord toggled once (state asserted after every press, so a double dispatch would show as no change); `⌘⇧F12` hid both, `⌘1` then brought Database back alone                                                                                                    | `shell-tool-windows.png`   |
| 3   | `⌘⇧A`, type `new con`, Enter: second console tab opens and is active                                                                                         | postgres | Pass. `console_1` opened, active, with focus in its SQL console                                                                                                                                                                                                            | `find-action.png`          |
| 4   | `⇧⇧` opens Search Everywhere on `All`; `Actions` tab lists actions with shortcuts; a disabled action is greyed                                               | postgres | Pass. Opened on `All`; `Actions` lists all 14 with shortcuts (`⇧⌘A`, `⇧⇧`, …); Cancel, Close Other Tabs, Select Next/Previous Tab and Back to Editor greyed                                                                                                                | `search-everywhere.png`    |
| 5   | Two consoles: run `SELECT 1` in tab 1 and `SELECT * FROM customers` in tab 2; switching tabs shows each one's own result; Services lists both with durations | postgres | Pass. Tab 1 kept `1`, tab 2 kept the two customers; Services shows both idle, 6 ms and 28 ms                                                                                                                                                                               | `two-consoles.png`         |
| 6   | `⌘⇧]` / `⌘⇧[` cycle tabs, `⌘W` closes, tab context menu "Close Others"; closing the last shows the empty state                                               | postgres | Pass. Cycling wraps both ways, `⌘W` on the rightmost tab activated its left neighbour `console_1`, Close Other Tabs left `console`, the last `⌘W` shows "No open consoles. Press ⇧⌘L…"                                                                                     | `tabs.png`                 |
| 7   | Native menu View ▸ Tool Windows ▸ Services toggles Services once (via `Menu.getApplicationMenu()` in `electronApp.evaluate`)                                 | sqlite   | Pass. One click hid Services, a second showed it again                                                                                                                                                                                                                     | `menu-dispatch.png`        |
| 8   | Resize Database and close Services, relaunch: layout restored                                                                                                | sqlite   | Pass. Database dragged 120 px wider and Services closed; after relaunch on the same profile both were restored to within 2 px                                                                                                                                              | `layout-restored.png`      |
| 9   | Wrong password: status bar shows the connect error, `Run` greyed in Find Action, Database node marked failed                                                 | mysql    | Pass. Status bar and console show MySQL's "Could not connect: Access denied…", the node is red "failed", `Run` greyed in Find Action. The node reads "Datasource", not "MySQL": the plugin name only arrives with a successful `session.open` — plan 004 names datasources | `connect-failed-shell.png` |

Bugs found here are fixed in this plan with a regression test, and the row says so.

---

## Deviations taken while implementing

- **Renderer tests live in `test/renderer/`, not `test/desktop/`.** The root program has no DOM lib
  and excludes the renderer; `test/renderer/tsconfig.json` (DOM, JSX) is a third `typecheck`
  program, as in `../preman`. There is no jsdom: the keymap tests feed fake key events and targets.
  `test/desktop/engine.test.ts` gained `session.close` as planned.
- **`tab.next` / `tab.previous` select the neighbouring tab, wrapping**, rather than reordering
  (decision 12). DataGrip's `⇧⌘]` / `⇧⌘[` are Select Next/Previous Tab; reordering waits for drag.
- **macOS shortcuts are formatted in Apple's modifier order**, `⌃⌥⇧⌘`, so Find Action reads `⇧⌘A`,
  as macOS menus and DataGrip show it, not the plan's `⌘⇧A`. The test
  `givenModShiftA_whenFormattedOnMac_thenReadsCmdShiftA` asserts `⇧⌘A`.
- **`TABLE_CRAFT_USER_DATA` sets the profile directory.** The harness gives every launch a fresh
  temporary profile, so the persisted layout cannot leak between smoke runs, and relaunches on the
  same one for live-test row 8. A test seam like decision 018; unset means the usual userData path.
- **Menu shape.** Help is a submenu with Find Action… (Electron's `help` role adds nothing useful
  here). View also carries Toggle Developer Tools. The Window role is macOS-only: elsewhere it adds
  Close with a registered `Ctrl+W`, which would close the window instead of the tab.
- **Shortcuts are matched on `KeyboardEvent.code`**, so `⇧⌘]` still matches when Shift turns the key
  into `}` and on non-US layouts' physical keys.
- **The palette's width is a token** (`density.paletteWidthPx`), not preman's literal `36rem`.
- **Live-test row 2 toggles each tool window off and back on** before `⌘⇧F12`, because with both
  already hidden Hide All restores what it last hid instead of hiding.
- **Live-test rows run as Vitest scenarios** in `test/e2e/shell.smoke.test.ts` (SQLite rows 7, 8 plus
  the three planned smoke cases) and `test/e2e/shell.databases.smoke.test.ts` (PostgreSQL rows 1–6,
  MySQL row 9). Playwright's keys are synthesised in the renderer, so they prove the keymap runs a
  chord once but not what macOS's native key-equivalent path does with a real keypress.

---

## Out of scope

- The explorer tree and object search provider: plan 005 fills `DatabasePane` and adds the `Tables`
  tab.
- CodeMirror and real caret position: plan 006.
- User-editable keymap and a keymap settings page: plan 013. The registry already makes the chord a
  lookup, so remapping is a settings feature, not a refactor.
- Split editors, detached tool windows, the right stripe's contents: not in v1 (decision 014).
- Multiple windows: one window (decision 010).
