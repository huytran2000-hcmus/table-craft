# Decisions

Architecture decision records. One file per decision, numbered, never renumbered. A decision that
is later reversed keeps its file and gains a status pointing at the record that reversed it.

A record is written when a meaningful alternative existed, or when a future reader would otherwise
reopen the choice. A ruling with no live alternative belongs in the diff, not here.

Status is one of `Proposed`, `Accepted`, `Reversed by NNN`. Claim the next number when a record is
started, not when it is merged.

| #   | Decision                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 001 | [Electron, with Bun as the toolchain](001-electron-with-bun-as-the-toolchain.md)                                                          |
| 002 | [Three processes, one engine per datasource](002-three-processes-one-engine-per-datasource.md)                                            |
| 003 | [The renderer stack is preman's](003-the-renderer-stack-is-premans.md)                                                                    |
| 004 | [Four kinds of package](004-four-kinds-of-package.md)                                                                                     |
| 005 | [Plugins load at runtime, built-ins included](005-plugins-load-at-runtime-built-ins-included.md)                                          |
| 006 | [Plugins are trusted and run in the engine](006-plugins-are-trusted-and-run-in-the-engine.md)                                             |
| 007 | [Capabilities, not plugin ids, shape the UI](007-capabilities-not-plugin-ids-shape-the-ui.md)                                             |
| 008 | [The plugin owns its language](008-the-plugin-owns-its-language.md)                                                                       |
| 009 | [Result sets stay in the engine](009-result-sets-stay-in-the-engine.md)                                                                   |
| 010 | [One global datasource list](010-one-global-datasource-list.md)                                                                           |
| 011 | [Auto-commit, with guards](011-auto-commit-with-guards.md)                                                                                |
| 012 | [Appearance is data](012-appearance-is-data.md)                                                                                           |
| 013 | [Every plugin passes one contract suite](013-every-plugin-passes-one-contract-suite.md)                                                   |
| 014 | [What v1 ships](014-what-v1-ships.md)                                                                                                     |
| 015 | [Every command is an action](015-every-command-is-an-action.md)                                                                           |
| 016 | [Plans and evidence are tracked](016-plans-and-evidence-are-tracked.md)                                                                   |
| 017 | [Database values cross the wire as the database prints them](017-database-values-cross-the-wire-as-the-database-prints-them.md)           |
| 018 | [The datasource comes from the environment until there is a list](018-the-datasource-comes-from-the-environment-until-there-is-a-list.md) |
| 019 | [Connection forms are manifest data](019-connection-forms-are-manifest-data.md)                                                           |
| 020 | [Secrets live in main and reach only their engine](020-secrets-live-in-main-and-reach-only-their-engine.md)                               |
| 021 | [Main stops engines, and Run reconnects](021-main-stops-engines-and-run-reconnects.md)                                                    |
| 022 | [The schema is the unit of introspection](022-the-schema-is-the-unit-of-introspection.md)                                                 |
| 023 | [Plugins share a splitter from plugin-api](023-plugins-share-a-splitter-from-plugin-api.md)                                               |
