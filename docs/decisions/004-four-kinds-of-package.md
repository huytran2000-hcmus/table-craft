# 004: Four kinds of package

Status: Accepted

## Decision

| Package                          | Role                                                                 | May depend on            |
| -------------------------------- | -------------------------------------------------------------------- | ------------------------ |
| `@table-craft/plugin-api`        | The contract: types, Zod schemas, `API_VERSION`, contract test suite | `zod`                    |
| `@table-craft/core`              | Plugin loader, sessions, result-set store, edit batches, history     | plugin-api               |
| `@table-craft/desktop`           | The Electron app                                                     | core, plugin-api         |
| `plugin-{postgres,mysql,sqlite}` | Built-in datasource plugins                                          | plugin-api, their driver |

There is no CLI in v1.

## Rationale

Plugins are runtime-loaded (decision 005), so third-party authors need something small and stable
to compile against that does not drag in the engine. Keeping the contract out of core also makes
its surface visible: anything exported from plugin-api is a public API with a version. Built-ins
depending on plugin-api alone proves the contract is sufficient. A CLI has no driving use case yet;
core being Electron-free keeps the door open.

## Consequences

- ESLint enforces the "may depend on" column.
- A change to plugin-api is a contract change: bump `API_VERSION` per semver and say so in the plan.
