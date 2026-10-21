# 007: Capabilities, not plugin ids, shape the UI

Status: Accepted

## Decision

A plugin declares capabilities, e.g. `sql`, `schemaTree`, `transactions`, `explain`, `ddl`,
`tableEdit`, and later `keyValue` or `documents`. It declares its connection form as a Zod schema
(`connectionSchema`) that the renderer turns into fields. The UI shows a feature when the
capability is present and never tests a plugin id.

## Rationale

The point of plugins is that Redis or MongoDB arrive without UI edits scattered across the
renderer. A SQL-shaped `Dialect` interface would not fit them; capabilities let a non-SQL plugin
light up a key browser instead of a console while sharing connections, the explorer and the grid.

## Consequences

- A new kind of datasource is a new capability, its protocol messages and its pane, added once.
- `if (pluginId === …)` in the renderer is a review blocker.
- The connection form only supports what the schema-to-form mapping supports; extending it is
  part of plugin-api.
