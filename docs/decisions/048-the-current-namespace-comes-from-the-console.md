# 048: The current namespace comes from the console

Status: Proposed. Amends 028.

## Decision

Unqualified names in a console complete and resolve against the console's own namespace, not the
catalog's. Three sources, the first that has an answer wins:

1. The script. The nearest statement before the caret that switches namespace (`USE db` on MySQL;
   `SET [SESSION | LOCAL] search_path`, `SET SCHEMA` and `RESET search_path` on PostgreSQL), run
   or not, names it: its first target naming an existing top-level namespace (`USE`; MySQL lists
   its databases as top-level schemas) or schema (a search path).
   The plugin's language recognises these statements through the shared tokenizer
   (`SqlDialectOptions.namespaceStatements`, `namespaceTarget`); `classify` marks them
   `setsNamespace`. The table editor's WHERE and ORDER BY bars skip this step.
2. The session. A plugin that declares the `currentNamespace` capability implements
   `Session.currentNamespace()`, a read of `DATABASE()` or `current_database(), current_schema()`.
   The engine calls it when a session opens, after a statement that sets the namespace or ends a
   transaction succeeds, and after Commit, Rollback and a mode change. The answer travels to the
   renderer on `session.open`, `statement.execute` and the transaction calls; the console keeps it,
   shows it in its toolbar and sends it back as `current` on `completion.complete` and
   `navigation.resolve`.
3. The catalog's current namespace, as before.

A failed statement or a failed read changes nothing. A new session, after a reconnect, starts from
its own read.

## Rationale

`USE` and `SET search_path` are how people work in a database with several databases or schemas,
and completion that ignores them offers the wrong tables. Decision 028 kept completion off the
console's session so a completion request never waits behind a running statement; that still
holds: the session is read only right after something the console itself ran, while it is idle,
and completion uses the value the renderer already has.

Querying the database is the truth; the statement text alone is not. `SET LOCAL` reverts on
rollback, `search_path` may name schemas that do not exist, a function or procedure can switch
database. Parsing the text is still needed for a script whose `USE` has not run yet, so the
script wins over the session there: what the user sees above the caret is what they mean.

The catalog cache keeps describing every namespace it lists; only which one counts as current
changes, so no new catalog state per console is needed.

## Consequences

- `CAPABILITIES` gains `currentNamespace`, `Session` gains `currentNamespace?()`, `StatementClass`
  gains `setsNamespace`, and the plugin API moves to 0.13.0. MySQL and PostgreSQL declare the
  capability; SQLite does not (`ATTACH` is out of scope).
- A `search_path` naming no existing schema reads as null: the console's namespace is unknown, the
  label hides, and completion falls back to the catalog's current namespace.
- Every namespace-switching statement costs one extra round trip; ordinary statements cost none.
- A namespace switched by a function, a procedure or a trigger shows up only after the next
  transaction end or switching statement.
- An export re-runs a read on a fresh session, which starts in the default namespace (decision
  040). A result read while the console was elsewhere is written from memory or its drained cursor
  instead; switching back to where the session started re-enables the re-run. A switch the engine
  could not read counts as elsewhere.
