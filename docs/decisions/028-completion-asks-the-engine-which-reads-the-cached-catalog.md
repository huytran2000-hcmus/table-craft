# 028: Completion asks the engine, which reads the cached catalog

Status: Accepted. Amended by 048.

## Decision

Schema-aware completion and go-to-declaration run in the engine. The renderer sends the console
text and caret offset; the plugin's `language` analyses the statement around the caret and answers
from a read-only `CompletionCatalog` the engine builds over its catalog cache (decision 022).

- Scope analysis — which relations a statement brings into scope, their aliases, CTEs and derived
  tables, and what clause the caret is in — is a shared helper in `@table-craft/plugin-api/sql`,
  configured per dialect like the splitter (decision 023). A plugin may replace it.
- Completion never touches the console's own session. Unqualified names resolve against the
  catalog's current namespace. A namespace not yet described is described on demand, and the
  answer waits for it at most `COMPLETION_DESCRIBE_DEADLINE_MS`; past that it answers with what is
  cached and the next request has the rest.
- A disconnected console completes keywords only and never connects to complete.

## Rationale

The renderer already holds a copy of every described catalog for the Database pane, so completing
there would save a round trip. It would also put SQL scope analysis in the renderer, which decision
008 rules out: it would have to know every dialect's quoting, folding and clause grammar, and a
non-SQL plugin could not bring its own completion at all. A MessagePort round trip is well under
the typing interval; CodeMirror's `validFor` keeps a request from firing on every keystroke within
one identifier.

## Consequences

- `SqlLanguage` gains `complete` and `resolve`; `API_VERSION` moves to 0.8.0.
- Completion is only as fresh as the cache: a table created in another tool appears after
  Synchronize, as in DataGrip. DDL run in the console already re-describes (plan 006).
- `SET search_path` or `USE` inside a console does not change what unqualified names resolve
  against; per-console schema selection belongs to plan 011. (Superseded by decision 048: the
  console's namespace, and a preceding switch in its script, now decide.)
