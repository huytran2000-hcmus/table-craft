# 045: The update lives in the main toolbar, before Settings

Status: Accepted

## Decision

An available update is shown by one **Update** button at the right end of the main toolbar,
immediately before Settings, and nowhere else unless asked (plan 020).

- The button exists only while there is something to say: a release is available, downloading
  (the label is the percentage), ready (**Restart to Update**), failed (**Update failed**, with
  Retry when retrying can help) or cannot be installed from where the app runs. While idle or
  checking it is not drawn.
- Clicking it opens a popover with `current → new`, the size, the reason when something went
  wrong, and the actions: Download, Cancel Download, Restart to Update, Retry, Release Notes, Skip
  This Version, Later, Dismiss. Each is an action in `renderer/actions/updateActions.ts`.
- **Help → Check for Updates…** checks at once and says "You're up to date" when nothing is newer;
  that notice is the only modal the updater shows.
- Main owns the state and pushes one `UpdateState` union, `idle | checking | available |
downloading | ready | error | ineligible`, on `table-craft:update.state`; the renderer draws it
  and never sees a URL.
- Nothing is downloaded or installed without a click. Restart to Update goes through the same
  close guard as a relaunch, so unsaved edits are asked about first.

## Rationale

A modal on launch interrupts the work the user opened the app for, and a notification is easy to
lose. JetBrains IDEs, which TableCraft follows, keep updates in the window chrome; the right end of
the toolbar beside Settings is where an app-level control is looked for, and an absent button costs
nothing on the many days there is no update.

## Consequences

- The toolbar's right group is Search Everywhere, Update, Settings; a new app-level button goes
  before Update.
- Automatic checks are quiet: a network failure or a manifest of a later schema leaves the button
  hidden and logs a warning. A manual check reports them.
