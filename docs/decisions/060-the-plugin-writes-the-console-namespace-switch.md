# 060: The plugin writes the console's namespace switch

Status: Proposed. Amends 048.

## Decision

The console toolbar's namespace label is a dropdown. It lists the namespaces the console's session
can switch to and runs, on that session, the statement the plugin writes for the one picked.

- `SqlLanguage.namespaceSwitch?: NamespaceSwitch` is present exactly when the plugin declares
  `currentNamespace`. `targets` (`topLevel` or `schema`) says which catalog namespaces a switch can
  name (`switchableTo`); `statement(path)` writes the switch; `transactional` says whether a
  rollback undoes it. `namespaceSwitcher(form, quoteIdentifier)` in `@table-craft/plugin-api/sql`
  builds it for the `use` and `searchPath` forms.
- MySQL writes `` USE `db` ``. PostgreSQL writes `SET search_path TO "schema"`: the one schema,
  always quoted, nothing appended.
- The engine answers `namespace.targets` (the cached namespaces `switchableTo` keeps, `refresh` to
  re-read) and `namespace.switchStatement`. The renderer runs the statement through the console's
  ordinary execute path: Output, history, Services and the namespace re-read of decision 048 all
  apply, the editor does not flash and result tabs stay.
- The same targets complete after `USE `, `SET search_path TO ` and `SET SCHEMA ` (`namespaceSlotAt`):
  non-system first, system last, the current one marked.
- The switch waits while the console connects, runs, asks a question or fetches rows, asks
  submit-or-discard over pending grid edits like Run (decision 057), runs inside an open
  transaction (saying so on PostgreSQL, where a rollback undoes it), and warns when the namespace
  read afterwards is not the one picked.

## Rationale

A user who knows which database they want should not have to type `USE` for it, and the label
already says where the console is. Running a real statement on the console's session keeps one
truth: the session, read back afterwards, not a renderer-side flag. Letting the plugin write it
keeps SQL knowledge in the plugin (decision 008).

Appending `public` to the search path would let unqualified names resolve in a schema the label
does not show, while completion reads only the current schema (decision 048); `pg_catalog` is
searched implicitly anyway. A user who wants a longer path types it.

## Consequences

- The plugin API moves to 0.19.0; the contract suite checks presence and that the statement moves
  `currentNamespace` to its target.
- `USE DEFAULT`-style keywords no longer show in the popup after `USE ` or `TO `; the names do.
- SQLite has no switcher; its label stays absent.
- A PostgreSQL switch drops whatever else the search path held; switching back restores only the
  one schema.
