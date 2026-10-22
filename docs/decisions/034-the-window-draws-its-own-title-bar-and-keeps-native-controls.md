# 034: The window draws its own title bar, and keeps the native window controls

Status: Accepted

## Decision

The main window has no system title bar. The renderer draws a main toolbar in its place, the way
DataGrip's New UI merges the header into the window (`datagrip-inventory.md` §1.1 "Main
toolbar/header", §1.4). The toolbar holds the window title, a datasource widget, the console run
controls (Run, Cancel, Commit, Rollback), Search Everywhere and Settings, and on Windows and Linux a
main-menu button. Every one of them invokes an existing action (decision 015); the toolbar owns no
behaviour of its own.

The window controls stay native on every platform. macOS uses `titleBarStyle: "hiddenInset"` with
the traffic lights placed inside the toolbar. Windows and Linux use `titleBarStyle: "hidden"` with
`titleBarOverlay`, so the system draws minimise, maximise and close, tinted from the active theme
and resized with the density. Main owns those options and re-applies them whenever the theme or
density changes, next to the window background colour it already sets (decision 032).

Without a frame, Windows and Linux lose their menu bar. The application menu stays the one declared
in `preload/menu.ts`; the main-menu button, and Alt pressed and released alone, pop it up under the
button. macOS keeps its global menu bar unchanged.

One setting, Appearance → "Use system title bar", restores the system frame (and on Windows and
Linux the menu bar) after a restart. It is the escape hatch for a window manager that draws the
overlay badly, and the fallback the Linux build relies on.

Decision 014's v1 list gains the frameless window under the app shell.

## Rationale

A drawn title bar is the single largest visual difference between the app and DataGrip, and the
space it frees is where DataGrip puts the controls a user reaches for most. Native controls keep
the parts users rely on by muscle memory — snap layouts on Windows, the traffic lights' hover and
full-screen behaviour on macOS, the accessibility of system buttons — which custom-drawn buttons
would each have to reimplement and would get subtly wrong.

Keeping the toolbar a view over actions means the menu, the palette, the shortcuts and the toolbar
cannot disagree about what is enabled, and the toolbar needs no tests of its own beyond "it invokes
the action".

The window frame cannot change on a live window, so the escape hatch is a restart-time setting
rather than an automatic detection that could guess wrong.

## Consequences

- Main builds the window's chrome options from the theme, density, platform and the setting in one
  pure function, and updates the overlay and traffic-light position on change.
- The renderer's top strip is a drag region; every control in it opts out. A new control added to
  the toolbar must be `no-drag` or it cannot be clicked.
- Evidence screenshots capture web contents only, so native controls appear in them only where a
  plan captures the screen deliberately.
- Run, Cancel, Commit and Rollback exist twice in the window, in the main toolbar and the console
  toolbar; anything that finds a button by name must say which toolbar it means.
