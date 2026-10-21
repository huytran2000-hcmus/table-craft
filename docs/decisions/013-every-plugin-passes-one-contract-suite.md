# 013: Every plugin passes one contract suite

Status: Accepted

## Decision

`@table-craft/plugin-api/testing` exports `runPluginContract(plugin, fixture)`: one Vitest suite
covering connect, introspection of a known fixture schema, execute, cancel, transactions, edit
batches, DDL, EXPLAIN, statement splitting, classification and completion, each gated on the
capabilities the plugin declares.

- SQLite runs it in memory on every `bun run test`.
- PostgreSQL and MySQL run it under `bun run test:db`, against `docker compose` services seeded
  with the fixture schema. CI runs both; locally `test:db` is opt-in.
- A Playwright smoke test drives the packaged app against SQLite: open, connect, run, edit,
  submit.

Unit tests use `givenX_whenY_thenZ` names.

## Rationale

With runtime plugins, "works with Postgres" must mean "passes the same suite as everything else",
and third-party authors should get that suite for free. Keeping Docker out of the default test run
keeps `bun run test` fast and offline. Testcontainers was the alternative; compose is simpler to
debug and reuse for manual testing.

## Consequences

- The fixture schema is per dialect but describes the same logical tables, so assertions are shared.
- A capability without contract coverage cannot be declared.
