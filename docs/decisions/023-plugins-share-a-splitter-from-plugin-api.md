# 023: Plugins share a splitter from plugin-api

Status: Accepted

## Decision

Amends 008. A plugin with the `sql` capability exports a `language` object, `split(text)` and
`classify(statement)`, and it still owns what they answer. `@table-craft/plugin-api/sql` also
offers a configurable tokenizer-based splitter and classifier that plugins may call:

```ts
sqlSplitter({
  dollarQuotes: boolean,         // PostgreSQL $tag$ … $tag$
  backslashEscapes: boolean,     // MySQL '\''
  delimiterCommand: boolean,     // MySQL DELIMITER //
  nestedBlockComments: boolean,  // PostgreSQL /* /* */ */
  blockKeywords: readonly string[], // BEGIN … END bodies that hold semicolons
});
```

The three built-ins use it with their own options and wrap its result where their dialect needs
more. The helper is pure TypeScript with no dependencies, so it stays inside plugin-api's "zod
alone" rule (decision 004).

## Rationale

Decision 008 rejected one lexer in core driven by dialect data, because every new dialect would
need a core change. Writing three splitters from nothing has the opposite problem: three copies of
the same string, comment and quoting rules, each with its own bugs. A helper in plugin-api is
optional, so a plugin still decides; a dialect the helper cannot express ignores it, and core still
never parses SQL.

## Consequences

- The helper is public API: changing its behaviour is an `API_VERSION` change.
- The contract suite feeds every SQL plugin the same tricky scripts (semicolons in strings,
  comments and quoted identifiers; empty statements) plus a few per dialect.
- Offsets are UTF-16 code units, the same as JavaScript strings and CodeMirror positions, so the
  renderer can map a statement to the editor without converting.
