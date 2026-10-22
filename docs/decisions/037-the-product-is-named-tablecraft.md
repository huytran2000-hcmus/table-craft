# 037: The product is named TableCraft

Status: Accepted

## Decision

The app's name is **TableCraft** wherever a person reads it: the window title, the macOS app menu
and About panel, Help → About on Windows and Linux, the bundle and installer names
(`TableCraft.app`, `TableCraft-<version>-<arch>.<ext>`, electron-builder's `productName`), error
hints, log prefixes, the README and the specification, and the `application_name` the PostgreSQL
plugin reports to the server.

Identifiers keep `table-craft`: the profile folder (`~/Library/Application Support/table-craft`,
`%APPDATA%\table-craft`, `~/.config/table-craft`), the Linux executable, the app id
`dev.table-craft.desktop`, the repository, the `@table-craft/*` packages, `table-craft-plugin.json`,
the IPC channels, the layout key in `localStorage`, the drag type, the engine service names and the
`TABLE_CRAFT_*` environment variables.

## Rationale

The name came from the repository and stayed lower case and hyphenated, which reads as a package,
not a product. Electron derives the profile folder from the app name, so renaming everything would
move every existing profile: datasources, console files, history, settings and themes would seem
lost without a migration. Keeping the folder name costs nothing a user sees. The app id names the
installation on Windows and the preferences domain on macOS, so changing it would make the next
build a different app. Linux executables are lower case by convention. The channel names, the
storage key and the package names are contracts between our own modules and plugins; renaming them
is churn with no reader.

## Consequences

- `main.ts` sets the app name to `TableCraft` but builds the profile path from a separate
  `table-craft` constant.
- `scripts/packaged-executable.ts` names the macOS and Windows executables `TableCraft` and the
  Linux one `table-craft`.
- On macOS `safeStorage` keeps its key in the keychain item `<app name> Safe Storage` (Electron's
  `electron_browser_main_parts.cc`), now `TableCraft Safe Storage`. An older development profile's
  Forever secrets were encrypted under `table-craft Safe Storage` and no longer decrypt; the app
  asks for them again, as it does for any secret that no longer decrypts. No release shipped the old
  name.
- First-launch text in the README quotes what macOS shows for `TableCraft.app`.
