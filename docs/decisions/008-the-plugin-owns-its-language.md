# 008: The plugin owns its language

Status: Accepted. Amended by 023.

## Decision

Each plugin with the `sql` capability implements statement splitting, the statement at a cursor,
statement classification (read, write, DDL, destructive) and completion. They run in the engine.
The renderer asks over the port (`statement.at`, `completion.request`) and renders the answer.

Syntax highlighting stays in the renderer: the manifest names a highlighter as data
(`"highlight": "postgresql"`), mapped to a CodeMirror language. No plugin code runs in the
renderer.

## Rationale

Dialects differ where it hurts: Postgres dollar quotes, MySQL `DELIMITER`, SQLite's loose typing,
and non-SQL query languages later. A shared lexer driven by dialect data was the alternative; it
would centralise the quirks in core and push every new dialect through a core change. A plugin
owning its language keeps a new datasource self-contained.

## Consequences

- Completion and cursor lookups cost a MessagePort round trip, well under a millisecond locally;
  the renderer debounces and drops stale responses.
- Plugins may share code by depending on a helper library; core does not provide one in v1.
- The destructive-statement guard (decision 011) trusts the plugin's classification.
