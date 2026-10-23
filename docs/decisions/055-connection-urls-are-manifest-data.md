# 055: Connection URLs are manifest data

Status: Proposed. Extends 019.

## Decision

A plugin describes its connection URL in its manifest, beside the fields it fills:
`connection.url` names the schemes, the form (`server` for `scheme://user:password@host:port/database`,
`file` for a path), which connection field each URL part fills, and which query parameters map to
which fields, with an optional value map (`ssl-mode=VERIFY_IDENTITY` → `verify-full`).

`@table-craft/plugin-api` holds the one parser and formatter, `parseConnectionUrl` and
`formatConnectionUrl`. Main runs them: the Data Sources dialog sends a pasted URL over
`datasources.parse-url` and gets back field values, secrets and the parameters it ignored; "Copy as
URL" asks `datasources.url` for the saved data source's URL. A password from a URL becomes the
password field's typed value, saved by its save mode like one typed in (decision 020). A formatted
URL never carries a secret field, and leaves out parameters at their default.

The contract suite checks the URL against the fields: every part and parameter fills a declared
field, only the password part fills a secret, the port fills a number field, mapped values are
among the field's options.

## Rationale

Connection forms are manifest data so main can draw them without starting a plugin (decision 019);
URLs belong with them for the same reason. A `parseConnectionUrl` plugin method would need an engine
before the data source exists, and every plugin would write the same `URL` handling with its own
bugs. The shapes are few: PostgreSQL, MySQL, MariaDB, SQL Server and ClickHouse URLs are all the
server form; SQLite and DuckDB are paths.

The renderer cannot import plugin-api (the fence in decision 002), so parsing runs in main, which
already reads manifests and holds secrets.

## Consequences

- `PluginManifest.connection` gains optional `url`; `PluginInfo` carries it to the renderer so the
  dialog shows the URL row and "Copy as URL" only for a plugin that has one.
- A parameter the manifest does not map, or a value outside the field's options
  (`sslmode=prefer`), is listed as ignored, not an error: the URL still fills what it can.
- libpq's `host`, `port`, `dbname`, `user` and `password` query parameters fill their parts, and a
  `jdbc:` prefix is dropped.
- A URL form a manifest cannot describe (several hosts, a Unix socket path) needs a new form and a
  contract change.
