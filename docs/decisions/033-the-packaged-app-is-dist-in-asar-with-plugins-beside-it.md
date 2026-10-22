# 033: The packaged app is `dist/` in asar, with the built-in plugins beside it

Status: Accepted

## Decision

An installer wraps exactly what `bun run build` produces, nothing else. The app's own bundles
(`dist/main`, `dist/engine`, `dist/preload`, `dist/renderer`) go into `app.asar`. The built-in
plugins do not: they ship as `extraResources` in `<resources>/plugins/<id>/`, outside the archive,
in the same shape a user plugin has in `<userData>/plugins/<id>/` (decision 005). Main finds every
path through one module that branches on `app.isPackaged` once; nothing else asks where it runs.
No `node_modules` and no source maps ship. The desktop package has no runtime `dependencies`,
because Vite inlines them.

macOS ships one DMG per architecture, arm64 and x64, each built and launched on its own
architecture; there is no universal binary. Windows ships an NSIS installer and Linux an AppImage,
built in CI and allowed to fail without failing the run (decision 014: best effort). Builds are
signed ad hoc. Developer ID signing and notarisation are configured only when the credentials are
in the environment, and nothing in this repository supplies them.

The version comes from git: a `vX.Y.Z` tag on the packaged commit makes the version `X.Y.Z`, and
any other commit packages as `0.0.0-dev.<short sha>`. The repository's `package.json` files stay at
`0.0.0`.

A packaged build is proven by launching it: the smoke harness can drive an installed executable
instead of `dist/main/main.js`, and one suite runs the daily loop of decision 013 (connect, browse,
run, edit, submit, history, settings, relaunch) against the packaged app on every platform CI
builds.

## Rationale

Plugins outside the archive are loaded by the same `import()` of a real file that loads user
plugins, so the packaged app exercises the runtime loader exactly as development does, and a user
can read what shipped. ESM `import()` and `utilityProcess.fork` from inside asar are the two
operations most likely to differ between a dev run and an installer; keeping plugins out removes
one, and the packaged smoke suite catches the other.

A universal macOS binary doubles the download for no user benefit and merges two builds nobody has
launched separately. Each architecture built and launched on its own runner is the only claim we
can check.

The tag is already how a release is cut (AGENTS.md); deriving the version from it means no commit
ever edits a version number, and an untagged build cannot be mistaken for a release.

## Consequences

- Main resolves the engine entry, preload, renderer and built-in plugin root through
  `main/paths.ts`; a new bundled file goes there too.
- A built-in plugin can be inspected, and replaced, in an installed app; that is the same trust a
  user plugin already has (decision 005).
- Gatekeeper warns about an ad-hoc-signed download. Distributing beyond the developer's own machine
  needs a Developer ID and notarisation, which the person shipping supplies.
- `0.0.0-dev.<sha>` builds are not upgrades of each other; nothing auto-updates in v1.
- Windows and Linux breakage shows as a red, non-blocking CI job, not a failed run.
