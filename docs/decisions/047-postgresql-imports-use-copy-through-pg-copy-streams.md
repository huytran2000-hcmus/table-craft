# 047: PostgreSQL imports use COPY through `pg-copy-streams`

Status: Accepted

## Decision

The PostgreSQL plugin writes import batches with `COPY <table> (<columns>) FROM STDIN` in the text
format, through `pg-copy-streams` (`from`), one COPY per `insertRows` call. The plugin escapes
each value for COPY's text format itself (`\\`, tab, newline, carriage return, `\N` for `NULL`,
`\x…` for `bytea`) in `plugins/postgres/src/bulk.ts`. Inside a transaction each COPY runs in a
savepoint, so a refused batch rolls back alone.

## Rationale

`pg` has no COPY API of its own; `pg-copy-streams` plugs into `client.query` as a submittable,
is the long-standing choice for COPY with `pg`, and is plain JavaScript on Node streams, so the
plugin bundle stays Node-only (decision 001). COPY is the fastest way into PostgreSQL and needs no statement
size limit, where a multi-row `INSERT` with parameters stops at 65,535 bind values and parses a
statement per batch. Writing the COPY protocol by hand on `pg`'s connection internals was the
alternative, and would break on a `pg` upgrade.

## Consequences

- `plugins/postgres` depends on `pg-copy-streams` (and `@types/pg-copy-streams` for development);
  Vite bundles it into the plugin.
- A COPY error names the row inside the batch only in PostgreSQL's message; the engine finds the
  bad row by retrying the batch row by row, as for every plugin.
- The gated large suite measured about 47 MiB/s for a 2.1 GiB file on a local container.
