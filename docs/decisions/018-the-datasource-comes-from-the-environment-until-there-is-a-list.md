# 018: The datasource comes from the environment until there is a list

Status: Accepted. Amended by plan 004.

## Decision

Until the datasource list of decision 010 exists, main picks the one datasource it opens from the
`TABLE_CRAFT_DATASOURCE` environment variable: JSON `{ "id", "pluginId", "config" }`, validated
when main starts. Unset or blank means an in-memory SQLite scratch database. A malformed value stops
the app with an error naming the variable. The engine still receives the datasource from main in
its boot message, exactly as it will once the list exists.

## Rationale

Plan 002 needs the app to reach Postgres and MySQL for its live test before any connection UI
exists. An environment variable keeps the seam in main, where the datasource list will live, so the
renderer and engine change nothing when the list replaces it. A hard-coded config or a renderer-side
picker would each be throwaway code in a process that must not own it (decision 002).

## Consequences

- The variable may carry a password in plain text. It is a development and test seam only; real
  credentials go through `safeStorage` once the list exists.
- `test/e2e` drives the app against each database by setting the variable per launch.
- The seam is removed, not extended, when the datasource list lands. (Superseded by the amendment
  below.)

## Amendment (plan 004)

The datasource list has landed, and the seam stays, narrowed. `TABLE_CRAFT_DATASOURCE` now adds one
ephemeral datasource to the list, first, named by its `id`. It is never written to
`datasources.json`, its secrets are held as Until restart, it is never read-only, and the Data
Sources dialog shows it but cannot save or delete it. The app opens a console on it at launch, as
before. Unset or blank adds nothing: the list starts with what `datasources.json` holds, and an
empty one shows "No data sources." There is no implicit in-memory SQLite any more; the smoke harness
passes `{ "id": "scratch", "pluginId": "sqlite", "config": { "path": ":memory:" } }` itself.

Removing the seam would have made every smoke suite drive the Data Sources dialog before it could
test anything else, and made `bun run desktop` against the `test:db` Postgres a dozen clicks.
Persisted datasources are seeded with the harness's `seedDatasources` instead; a Forever secret
cannot be seeded, because it is encrypted by the launched app's `safeStorage`.
