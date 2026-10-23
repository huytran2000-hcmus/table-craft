# 043: Query parameters are found by the plugin and bound by the driver

Status: Proposed

## Decision

The plugin's language finds parameters (`SqlLanguage.parameters`) with the shared tokenizer, so a
marker inside a literal, a quoted identifier, a comment, a dollar quote or after `::` is never one.
Each plugin declares its styles: PostgreSQL `:name` and `$1`, MySQL and SQLite `:name` and `?`.
`script.split` returns each statement's parameters, so the run already in flight learns them
without another request.

The renderer asks for values in one Parameters dialog per run, after the destructive confirmation:
one row per distinct name across the batch, text or NULL. It sends them as `statement.execute`'s
`parameters`, a record from the statement's own names to values. The engine calls the plugin's
`bind(statement, values)`, which rewrites each marker to the driver's native placeholder (`$n` on
`pg`, `?` on `mysql2` and `node:sqlite`) and returns the value list, and passes it to
`Session.execute(sql, params)`. Values never enter the SQL text. The setting
`console.parameters` turns detection off, and then the text runs verbatim.

## Rationale

String interpolation is how SQL injection happens, even in a tool where the user types both the
statement and the value; a quote in a value must land as data. Every driver we ship binds
natively, and binding keeps the database's own type inference.

Detection must agree with the splitter about what is a literal or a comment, and only the plugin
knows its dialect (decision 008). Rewriting `:name` to the native style in the plugin, not the
driver, lets one named value fill several markers on drivers without named binding and keeps the
three drivers' differences out of the engine.

Values are text or `null`, as the user types them: the database converts them as it would a
quoted literal, which is what a user expects from a prompt. A typed entry (number, date, JSON) was
the alternative; it would need per-dialect type pickers and cannot know the column type before
the statement runs.

## Consequences

- `Session.execute` gains an optional `params`, `SqlLanguage` gains `parameters` and `bind`, and the
  plugin API moves to 0.11.0.
- A `?` is named `?1`, `?2`… by position within its statement; the dialog numbers them across the
  whole batch and maps them back, so a script of several `?` statements asks once per marker.
- Text values bind as text: PostgreSQL infers the type from context, so `$1 + 1` may need a cast
  (`$1::int`); MySQL and SQLite coerce text freely.
- The history records the values with the statement, as JSON; restoring a statement seeds the
  next prompt. Values are stored in plain text, like the SQL itself.
- Explain sends its statement verbatim; explaining a parameterised statement is out of scope.
- SQLite's `?NNN`, `@name` and `$name` are not detected.
