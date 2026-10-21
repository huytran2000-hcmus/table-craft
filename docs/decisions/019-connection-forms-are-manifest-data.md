# 019: Connection forms are manifest data

Status: Accepted. Amends 007.

## Decision

A plugin describes its connection form in `table-craft-plugin.json` under `connection.fields`, as
data. Each field has a `key`, `label`, `kind` (`text`, `number`, `password`, `file`, `select`,
`checkbox`), and optionally `default`, `required`, `placeholder`, `options` (for `select`), `group`
(`general` or `advanced`) and `secret`. `connectionSchema` stays in code and remains the validator:
the engine parses the saved config with it before `connect`.

The contract suite checks that the two agree: every field key is accepted by `connectionSchema`,
every required key in the schema has a field, and every `password` field is `secret`.

## Rationale

Decision 007 said the renderer would build the form from the plugin's Zod schema. The renderer
cannot run plugin code (decision 002), main must not run it (decision 006), and no engine exists
until a datasource has been saved. Converting the schema to JSON Schema inside a throwaway engine
would work but costs a process spawn to open a dialog, and JSON Schema carries no label, grouping
or secret flag anyway, so a second description would be needed regardless. Manifest data is
readable without executing code, which decision 005 already relies on for plugin names.

## Consequences

- Main reads forms with the same manifest discovery the loader uses, and the dialog opens at once.
- `secret` is what tells main which values go to `safeStorage` (decision 020). A plugin cannot
  leak a secret into `datasources.json` by forgetting to mark it, because the contract suite fails.
- A field kind the form does not support needs a plugin-api change and an `API_VERSION` bump.
