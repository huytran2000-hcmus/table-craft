# 015: Every command is an action

Status: Accepted

## Decision

The renderer has one action registry. An action has a stable id (`console.executeStatement`,
`explorer.refresh`), a title, an optional icon and default shortcut, a `when` predicate over the
current context (focused pane, selected node, datasource capabilities), and a `run` function.
Toolbar buttons, menus, context menus, keyboard shortcuts, Find Action (⌘⇧A) and Search
Everywhere (⇧⇧) all invoke actions by id; none of them carries behaviour of its own.

Shortcuts are bound through a keymap that maps chords to action ids, so a later keymap setting is
data, not code.

## Rationale

DataGrip exposes almost every command four ways: toolbar, context menu, shortcut and Find Action.
Without a registry each feature wires its own handlers, the four drift, and Find Action can only
ever list what someone remembered to register. The inventory's suggested architecture
(`docs/design/datagrip-inventory.md`, section 12) makes the same point. Capability-gated `when`
predicates are also where decision 007 meets the UI.

## Consequences

- A button whose `onClick` does work instead of calling an action is a review blocker.
- Disabled state and tooltips (title plus shortcut) come from the registry, so they are consistent.
- The registry lives in the renderer and runs in the renderer; an action that needs the engine
  sends a protocol message like any other code.
