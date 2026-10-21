# 017: Database values cross the wire as the database prints them

Status: Accepted

## Decision

Every plugin maps a cell to the same wire value for the same stored value, by these rules:

- Dates, times and timestamps travel as the database's own text (`2024-02-29 13:45:30`), never as a
  JavaScript `Date`. Postgres registers identity type parsers; MySQL sets `dateStrings`; SQLite
  stores them as text already.
- Exact numerics (`NUMERIC`, `DECIMAL`) travel as strings carrying every digit the database
  returned.
- Integers travel as numbers when `Number.isSafeInteger` holds and as the `bigint` tag otherwise
  (`toWireInteger` in plugin-api).
- Booleans travel as booleans, including MySQL `TINYINT(1)` and SQLite columns declared `BOOLEAN`.
- JSON values travel as the `json` tag holding the database's text, unparsed.
- Binary values travel as the `bytes` tag: a hex preview of the first bytes plus the full length.
- `NULL` is `null`.

The contract suite pins the rules with one `type_probe` table that every database's schema creates
with the same values, and asserts the same expected rows for every plugin.

## Rationale

A `Date` is an instant in the client's time zone; a `TIMESTAMP WITHOUT TIME ZONE` is not an
instant, so converting it shifts the value by the engine's offset and the grid lies. Turning a
`DECIMAL(20,4)` into a double loses digits a finance user will notice. Parsing JSON and then
stringifying it again reorders keys and normalises whitespace, so the user no longer sees what is
stored. The database's own text is exact, cheap, and what every other client shows.

The alternative, a richer typed wire form (a `date` tag with an ISO instant, a `decimal` tag), was
rejected for v1: it buys formatting options the grid does not have yet and costs a conversion in
every plugin. The existing `date` tag stays for plugins whose driver only yields `Date`.

## Consequences

- Sorting a fetched set in the engine must sort these strings by the column's type, not as text.
- The time zone of the engine process does not change what a `TIMESTAMP` shows; the contract suite
  runs that case under a distant `TZ`.
- A new plugin proves the rules by seeding `type_probe` and passing the shared expected rows.
