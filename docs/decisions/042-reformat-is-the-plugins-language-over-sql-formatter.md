# 042: Reformat is the plugin's language, over `sql-formatter`

Status: Proposed

## Decision

Reformat Code asks the engine (`sql.format`), which calls the plugin's `SqlLanguage.format(text,
options)`. The built-ins build it with `sqlFormatter` from `@table-craft/plugin-api/sql`, a thin
layer over the `sql-formatter` package (MIT), bundled into each plugin
with its dialect: `postgresql`, `mysql` or `sqlite`. The options are the `editor.format` settings,
sent with each request: `keywordCase` (`upper`, `lower`, `preserve`), `indentWidth` (1–8) and
`linesBetweenStatements` (0–5). `format` is a required member of `SqlLanguage`, so the plugin API
moves to 0.11.0.

The layer keeps what the formatter would damage: a multi-line block comment is swapped for a
stand-in and restored byte for byte, the plugin's own parameter styles are declared so `:name`,
`?` and `$1` stay whole, and a MySQL script with `DELIMITER` is refused with a reason rather than
reflowed. A failure is one line the console logs to Output; the text is left as it was.

## Rationale

SQL knowledge belongs to the plugin (decision 008), and the dialect decides what a keyword, a
quote or a placeholder is. Writing a formatter of our own over the shared tokenizer would be
thousands of lines for layout rules `sql-formatter` already has for all three dialects, with tests.
Running it in the renderer would cross the fence and leave a fourth plugin no say.

`sql-formatter` is pure JavaScript (its parser is `nearley`; `argparse` serves only its CLI and is
not bundled), works under Node and in a bundle, and bundling it per plugin keeps each plugin
self-contained (decision 005). `pgFormatter` needs Perl and knows only PostgreSQL.

## Consequences

- A plugin without a good formatter can return its input; the action stays.
- The formatter's layout is its own; we tune it only through the three settings. New options are a
  settings change, not a contract change.
- `sql-formatter` does not understand MySQL `DELIMITER` or every PostgreSQL extension; such text
  fails with the formatter's message instead of being mangled.
- Plan 022 and later SQL work reuse the same tokenizer; the formatter does not parse for them.
