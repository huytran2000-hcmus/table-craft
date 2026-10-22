# 032: Settings live in main, and the renderer applies them

Status: Accepted

## Decision

User preferences are one file, `<userData>/settings.json` (decision 010), owned by main like
`datasources.json`: a versioned, zod-validated document, written atomically, set aside as
`settings.json.corrupt-<ms>` when it cannot be read, with every missing field taking its default.
Main answers two invoke channels, read and write, and broadcasts the saved document to every
window after a write. The renderer holds a copy in a store and applies it: appearance through the
CSS variables `renderer/appearance/apply.ts` writes (decision 012), and every other preference by
reading the store where it is used. A change applies and saves at once; there is no Apply button.

The layout in `localStorage` stays what it is: per-window memory (pane sizes, open tabs, the
chosen extractor, the value panel), not preferences.

Built-in themes are complete token sets held as pure data in one module both main and the
renderer import; main needs the active theme's canvas colour for the window's first paint and
sets `nativeTheme.themeSource` so native menus, scrollbars and dialogs match. User themes are JSON
files in `<userData>/themes/`, each naming a built-in base and overriding colour tokens only. Main
reads and validates them, because zod stays out of the renderer (`preload/bridge.ts:2-3`), and
hands the renderer each one either resolved over its base or with its errors. An invalid theme is
listed with its errors and cannot be chosen; a chosen theme that has since become invalid or
disappeared falls back to Dark with a notice.

Result paging preferences travel with each request: the renderer passes the page size and the
Fetch All cap on `statement.execute`, `table.query` and `result.fetchMore`. The engine keeps no
preferences of its own.

Data formats are display only. They change what the grid draws and measures, never what is copied,
exported, filtered, edited, submitted or recorded in history, all of which keep the database's own
text (decision 017). Temporal values are not reformatted.

## Rationale

Main already owns the profile's files and the window (decision 002), and is the only process that
can validate a user theme with zod, set the native theme, and paint the window background before
the renderer's bundle loads. The renderer is the only process that draws, so it applies. Keeping
both sides on one document, broadcast after each write, means a second window cannot drift.

An engine holding preferences would need a push on every change, to every engine, and a restart
race at connect. Passing two numbers per request costs nothing and makes each call self-describing.

Reformatting a timestamp means parsing each dialect's text and choosing a time zone, which is
exactly what decision 017 declined to do. Grouping digits and naming NULL are string operations on
text the database printed, so they cannot misstate a value.

## Consequences

- `settings.json` gains a version and a migration map from its first release, like
  `datasources.json`.
- Every preference has a default in one module, and a missing or out-of-range field reads as its
  default rather than failing the file.
- Copying a grouped number copies the digits without separators; a reviewer who sees `1,234` in a
  cell and `1234` in the clipboard is seeing the design, not a bug.
- A theme file edited on disk takes effect when the Settings dialog reloads the list or at the next
  launch; nothing watches the folder.
- Date and time formats remain the database's; a request for them needs this record revisited.
