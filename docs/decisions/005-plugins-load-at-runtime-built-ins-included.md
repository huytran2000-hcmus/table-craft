# 005: Plugins load at runtime, built-ins included

Status: Accepted

## Decision

A plugin is a directory with a `table-craft-plugin.json` manifest (`id`, `version`, `apiVersion`,
`entry`, `capabilities`, `highlight`) and an ESM entry exporting a `DatasourcePlugin`. The loader in
core discovers plugins in two roots:

- `resources/plugins/*` inside the app: the built-ins, bundled there at build time
- `<userData>/plugins/*`: user-installed

Built-ins go through the same discovery, manifest validation and `import()` as user plugins. The
manifest is validated with Zod and `apiVersion` is checked against core's `API_VERSION` by semver;
a failure marks the plugin unavailable with a reason and never stops the app.

## Rationale

The user wants Redis, MongoDB and others addable later without a release of table-craft. Loading
built-ins through a static import would leave the runtime path untested by daily use until the
first third-party plugin found its bugs.

## Consequences

- Plugin ids must be unique; a user plugin with a built-in's id is an error naming both paths,
  not a silent override.
- Installing a plugin in v1 is copying a directory; a marketplace is out of scope.
- The manifest is readable without executing code, so the connection list can show a plugin's
  name and icon before any engine starts.
