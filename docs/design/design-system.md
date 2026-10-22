# Design system

Every colour, spacing step, radius and font in the renderer is a token, written as a CSS variable
by `renderer/appearance/apply.ts` from the active theme, font settings and density (decision 012).
Components reference tokens, never literals.

_To be filled in when the appearance layer lands: the full token list, density values, and the
contrast pairs the theme test asserts._

## Shell tokens

Plan 003's shell draws from these. The CSS variable is set by `apply.ts`; the Tailwind name is what
components write (`app.css` maps one to the other).

| Token (`appearance/tokens.ts`) | CSS variable             | Tailwind                     | Dark / comfortable | Used by                                                         |
| ------------------------------ | ------------------------ | ---------------------------- | ------------------ | --------------------------------------------------------------- |
| `density.stripeWidthPx`        | `--tc-stripe-width`      | `w-stripe`                   | 36 px              | The left and right tool-window stripes                          |
| `density.tabHeightPx`          | `--tc-tab-height`        | `h-tab`, `size-tab`          | 32 px              | Editor tabs, tool-window headers, stripe buttons, palette input |
| `density.statusBarHeightPx`    | `--tc-status-bar-height` | `h-status-bar`               | 24 px              | The status bar                                                  |
| `density.iconPx`               | `--tc-icon`              | `size-icon`                  | 16 px              | Every Phosphor icon and the tab close button                    |
| `density.paletteWidthPx`       | `--tc-palette-width`     | `w-palette`                  | 576 px             | Find Action / Search Everywhere                                 |
| `colors.selection`             | `--tc-selection`         | `bg-selection`               | `#2e436e`          | Pressed stripe button, selected palette and Services rows       |
| `colors.success`               | `--tc-success`           | `text-success`, `bg-success` | `#5fb865`          | The connected datasource's dot                                  |
| `colors.danger`                | `--tc-danger`            | `text-danger`, `bg-danger`   | `#f75464`          | A failed datasource, console or connect message                 |
| `colors.panel`                 | `--tc-panel`             | `bg-panel`                   | `#2b2d30`          | Stripes, tool windows, tab strip, status bar, palette           |
| `colors.canvas`                | `--tc-canvas`            | `bg-canvas`                  | `#1e1f22`          | The editor area and the active tab                              |
| `colors.raised`                | `--tc-raised`            | `bg-raised`                  | `#393b40`          | Hovered tabs and buttons, the tab context menu                  |
| `colors.accent`                | `--tc-accent`            | `border-accent`, `bg-accent` | `#3574f0`          | The active tab's underline, an active resize handle             |
| `colors.border`                | `--tc-border`            | `border-line`, `bg-line`     | `#43454a`          | Dividers and resize handles at rest                             |
| `density.dialogWidthPx`        | `--tc-dialog-width`      | `w-dialog`                   | 880 px             | The Data Sources dialog                                         |
| `density.dialogHeightPx`       | `--tc-dialog-height`     | `h-dialog-height`            | 580 px             | The Data Sources dialog                                         |
| `density.dialogListWidthPx`    | `--tc-dialog-list-width` | `w-dialog-list`              | 240 px             | The Data Sources dialog's datasource list                       |

The active editor tab is `bg-canvas` with a 2 px `border-accent` underline; inactive tabs are
`text-ink-muted` on the strip's `bg-panel` and show their close button on hover. Disabled actions,
in the palette and on toolbar buttons, are `text-ink-muted` at reduced opacity.

## Database explorer

Plan 005. Catalog rows reuse the shell's row height (`h-row`), icon size and colours, and add two
tokens.

| Token (`appearance/tokens.ts`) | CSS variable        | Tailwind          | Dark      | Used by                                          |
| ------------------------------ | ------------------- | ----------------- | --------- | ------------------------------------------------ |
| `colors.searchMatch`           | `--tc-search-match` | `bg-search-match` | `#6b5a1e` | The characters speed search matched, as `<mark>` |
| `colors.keyIcon`               | `--tc-key-icon`     | `text-key-icon`   | `#d9a343` | A primary-key column, a key node                 |

Node icons are Phosphor glyphs named in `renderer/ui/icons.ts`, drawn by `panes/explorerLabels.tsx`:

| Node                        | Icon (`ui/icons.ts`)                                          | Colour                                 |
| --------------------------- | ------------------------------------------------------------- | -------------------------------------- |
| database namespace          | `DatabaseIcon` (Database)                                     | `text-ink-muted`; `text-danger` failed |
| schema namespace            | `SchemaIcon` (TreeStructure)                                  | `text-ink-muted`; `text-danger` failed |
| group                       | `FolderIcon`                                                  | `text-ink-muted`                       |
| table, view, materialized   | `TableIcon`, `ViewIcon` (Eye), `MaterializedViewIcon` (Stack) | `text-accent`                          |
| column                      | `ColumnIcon` (Columns)                                        | `text-ink-muted`                       |
| primary-key column, key     | `KeyIcon`                                                     | `text-key-icon`                        |
| foreign-key column, FK node | `KeyIcon`                                                     | `text-accent`                          |
| index                       | `IndexIcon` (ListDashes)                                      | `text-ink-muted`                       |
| routine, sequence           | `RoutineIcon` (Function), `SequenceIcon` (ListNumbers)        | `text-ink-muted`                       |
| NOT NULL, after the type    | `NotNullIcon` (Asterisk), 12 px                               | `text-ink-muted`                       |
| loading, synchronizing      | `SpinnerIcon`, spinning                                       | `text-ink-muted`                       |
| error row                   | `WarningIcon`                                                 | `text-danger`                          |

A row's name keeps its width and truncates last; the detail after it (type, count, columns, hint)
is `text-ink-muted` and gives way first. A failed namespace and its error row are `text-danger`.
The speed search field floats at the tree's top right, `border-line` on `bg-raised`, and turns
`border-danger text-danger` when nothing matches. Synchronize, Collapse All and Copy use the
Phosphor `ArrowsClockwise`, `ArrowsInLineVertical` and `CopySimple` glyphs.

## SQL console

Plan 006. The CodeMirror editor takes its theme from the same variables (`console/editorTheme.ts`):
text in `font-editor` at `text-editor`, background `bg-canvas`, gutter `bg-panel` with
`text-ink-muted` numbers, selection `colors.selection`, search matches `colors.searchMatch`. Syntax
colours are their own tokens, read by the `HighlightStyle` through the CSS variable only.

| Token (`appearance/tokens.ts`) | CSS variable                | Tailwind                     | Dark      | Used by                                                  |
| ------------------------------ | --------------------------- | ---------------------------- | --------- | -------------------------------------------------------- |
| `colors.syntax.keyword`        | `--tc-syntax-keyword`       |                              | `#cf8e6d` | Keywords, operator keywords, `TRUE`/`NULL`, type names   |
| `colors.syntax.string`         | `--tc-syntax-string`        |                              | `#6aab73` | String literals                                          |
| `colors.syntax.number`         | `--tc-syntax-number`        |                              | `#2aacb8` | Numeric literals                                         |
| `colors.syntax.comment`        | `--tc-syntax-comment`       |                              | `#7a7e85` | Line and block comments, italic                          |
| `colors.syntax.identifier`     | `--tc-syntax-identifier`    |                              | `#c77dbb` | Quoted identifiers                                       |
| `colors.syntax.operator`       | `--tc-syntax-operator`      |                              | `#bcbec4` | Operators and punctuation                                |
| `colors.syntax.variable`       | `--tc-syntax-variable`      |                              | `#56a8f5` | Bind parameters (`$1`, `:name`, `?`)                     |
| `colors.syntax.bracketMatch`   | `--tc-syntax-bracket-match` |                              | `#43454a` | The matching bracket's background                        |
| `colors.statementFlash`        | `--tc-statement-flash`      |                              | `#3d4a2e` | The statement just run, for 900 ms                       |
| `colors.warning`               | `--tc-warning`              | `text-warning`, `bg-warning` | `#e0a84a` | Output warnings (skipped, cancelled), `transaction open` |

The toolbar reads left to right: Run (primary), Run All, Explain Plan and Explain Analyse when the
plugin declares them (plan 012), Cancel when the plugin can cancel, then the transaction controls
when it declares `transactions`: a `Tx: Auto` / `Tx: Manual` select, Commit (`Check`), Rollback
(`ArrowCounterClockwise`) and the `transaction open` badge in `bg-warning text-canvas`. Run All is
`FastForward`. The two explain buttons are `compact`, the icon alone with the title and chord in the
tooltip, so a manual-mode toolbar still fits a 1200 px window: Explain Plan `TreeView`, Explain
Analyse `Gauge` with `tone="warning"`, a `border-warning` frame and `text-warning`, because it runs
the statement. Toolbar buttons never wrap (`shrink-0 whitespace-nowrap`); a long error gives way
instead, and so does the datasource name · plugin name at the end, truncated with an ellipsis.

Below the editor, the result strip holds `Output` and then `Result 1`, `Result 2`… or `Plan`,
`Plan (analysed)`, each with a `PushPin` that fills when pinned. The Output log is `font-editor`: the time and the statement's
first line in `text-ink-muted`, then the message: `text-ink` for results and notes, `text-warning`
for warnings, `text-danger` for errors, with the hint muted after it.

The completion popup (plan 009) is a `.cm-tooltip` in `bg-raised` with a `border-line` edge, rows in
`font-editor` at `text-editor`, the selected row in `colors.selection`, the matched characters in
`text-accent` without an underline, and the detail (type, namespace, foreign key) right-aligned in
`text-ink-muted` italic. Each row starts with the Database pane's glyph for its kind at `size-icon`
(`console/completionGlyphs.tsx`, drawn once per kind as static markup):

| Kind      | Glyph (`ui/icons.ts`)          | Colour           |
| --------- | ------------------------------ | ---------------- |
| namespace | `SchemaIcon` (`TreeStructure`) | `text-ink-muted` |
| table     | `TableIcon`                    | `text-accent`    |
| view      | `ViewIcon` (`Eye`)             | `text-accent`    |
| column    | `ColumnIcon` (`Columns`)       | `text-ink-muted` |
| alias     | `AliasIcon` (`At`)             | `text-ink-muted` |
| cte       | `CteIcon` (`BracketsRound`)    | `text-accent`    |
| join      | `JoinIcon` (`Intersect`)       | `text-accent`    |
| function  | `RoutineIcon` (`Function`)     | `text-ink-muted` |
| keyword   | `KeywordIcon` (`TextT`)        | `text-ink-muted` |

Go to Declaration on an alias flashes the declaration in `colors.statementFlash`, like a run.

## Result grid

Plan 007. The grid is `font-grid` at `text-grid`, rows `h-row`, and reuses the shell's panel, line
and accent colours; it adds three tokens and leans on two older ones.

| Token (`appearance/tokens.ts`) | CSS variable                 | Tailwind               | Dark / comfortable | Used by                                        |
| ------------------------------ | ---------------------------- | ---------------------- | ------------------ | ---------------------------------------------- |
| `colors.gridSelection`         | `--tc-grid-selection`        | `bg-grid-selection`    | `#214283`          | Selected cells; stronger than `bg-selection`   |
| `colors.gridNull`              | `--tc-grid-null`             | `text-grid-null`       | `#7c7f87`          | `<null>`, italic, in cells and the value panel |
| `density.valuePanelWidthPx`    | `--tc-value-panel-width`     | `w-value-panel`        | 360 px             | The value panel beside the rows                |
| `colors.gridStripe`            | `--tc-grid-stripe`           | `bg-grid-stripe`       | `#26282b`          | Every second row                               |
| `density.gridColumnMaxWidthPx` | `--tc-grid-column-max-width` | `--spacing-column-max` | 320 px             | The cap on a column's automatic width          |

The header and the row-number gutter are `bg-panel` with `border-line` dividers and stay put while
the rows scroll; gutter numbers are `text-ink-muted`, `text-ink` on a selected row. A header holds a
type glyph in `text-ink-muted` (`TYPE_GLYPHS` in `ui/icons.ts`: `Hash` number, `TextAa` text,
`Calendar` date, `ToggleLeft` bool, `BracketsCurly` json, `Binary` bytes), the name, and, when
sorted, an `ArrowUp` / `ArrowDown` in `text-accent` followed by the key's position when there are
several. The focused cell has a 1 px `outline-accent` inset. The resize handle is the header's
right 8 px with `cursor-col-resize`.

The toolbar is `h-row` on `bg-panel`: icon-only buttons (`ArrowDown` Fetch Next Page,
`ArrowLineDown` Fetch All, `ArrowClockwise` Rerun, `Stop` Cancel Fetch), the state label in
`text-ink-muted`, a spinner while fetching, then on the right the extractor `<select>`,
`CopySimple` Copy, `Export` Export Data… and `SidebarSimple` Value Panel, `bg-selection` while
open. A disabled button explains itself in its tooltip. The closed-connection banner is an `h-row`
strip in `bg-panel`, `text-ink-muted` italics, above the rows.

## Table data editor

Plan 008. A table tab reuses the result grid and the console's tint border; its tab carries the
`Table` icon. Pending changes colour the row background through three tokens:

| Token (`appearance/tokens.ts`) | CSS variable         | Tailwind           | Dark / comfortable | Used by                                       |
| ------------------------------ | -------------------- | ------------------ | ------------------ | --------------------------------------------- |
| `colors.editModified`          | `--tc-edit-modified` | `bg-edit-modified` | `#2f4a6b`          | A changed cell in a held row                  |
| `colors.editInserted`          | `--tc-edit-inserted` | `bg-edit-inserted` | `#2f4d34`          | Every cell of a row to insert                 |
| `colors.editDeleted`           | `--tc-edit-deleted`  | `bg-edit-deleted`  | `#4d2f33`          | Every cell of a row to delete, `line-through` |

Selection (`bg-grid-selection`) wins over the edit colours. A pending `NULL` reads `<null>` and a
pending default `<default>`, both italic `text-grid-null`. The inline cell editor is an `<input>`
filling the cell with the `outline-accent` inset.

Above the grid sit the WHERE and ORDER BY bars: single-line CodeMirror fields on `bg-canvas` with a
`border-line` frame that turns `border-danger` on a refused clause, the label in `text-ink-muted`,
and the datasource name · plugin name on the right. The database's message sits under them in
`text-danger` with the hint muted. A read-only table shows an `h-row` banner in `bg-panel`,
`text-ink-muted`, `Read-only: <reason>`. The result toolbar gains icon-only `Plus` Add Row,
`Copy` Duplicate Row, `Trash` Delete Rows, `ArrowUUpLeft` Revert Selected, `FileSql` Preview,
`CheckCircle` Submit, the `Tx: Auto` label, and `Sigma` Count Rows. The footer (`h-row`,
`text-ink-muted`) holds `3 pending changes`, the counted `12,345 rows`, and the last notice. The
preview is a 40 rem modal listing the numbered statements in `font-editor`.

## DDL and SQL generation

Plan 010. A DDL tab carries the `DdlIcon` glyph (Phosphor `FileCode`, `size-icon`) where a console
carries `Terminal` and a table tab `Table`, and the console's tint border. Its toolbar is an `h-tab`
`bg-panel` strip with icon-only `ArrowsClockwise` Refresh, `CopySimple` Copy and `Plus` Open in
Console, the qualified name in `text-ink-muted`, and the datasource name · plugin name on the right;
an error sits under it in `text-danger` with the hint muted. The body is a read-only CodeMirror view
(`ui/SqlView.tsx`) on `bg-canvas` with line numbers, the console's theme and syntax tokens, shared
with the SQL Generator's preview.

Quick Documentation (`Info`) is a `ui/Popover.tsx`: `bg-raised`, a `border-line` frame, `rounded`,
`shadow-lg`, `text-ui`, below the anchor with a 4 px offset. Its header (`border-b border-line`)
holds the kind in `text-ink-muted` and the qualified name and comment; section titles are
`text-ink-muted`, names and types `font-grid text-grid`. Columns use the explorer's marks: a filled
`KeyIcon` for the primary key, an outlined one for a foreign key, both `text-key-icon`, else a muted
`ColumnIcon`; NOT NULL wears `NotNullIcon` (`Asterisk`). Foreign keys read `→` outgoing and `←` incoming. The
body scrolls inside the popover's maximum.

The SQL Generator (`Code`) is a modal like the others, wider: the statements are a segmented radio
group in a `border-line` frame, the chosen one `bg-selection`, the rest `hover:bg-raised`; the
preview is `h-60` on `bg-canvas`; Open in Console is the primary button.

| Token (`appearance/tokens.ts`) | CSS variable           | Tailwind               | Dark / comfortable | Used by                              |
| ------------------------------ | ---------------------- | ---------------------- | ------------------ | ------------------------------------ |
| `density.popoverWidthPx`       | `--tc-popover-width`   | `max-w-popover`        | 480 px             | Quick Documentation's maximum width  |
| `density.popoverHeightPx`      | `--tc-popover-height`  | `max-h-popover-height` | 360 px             | Quick Documentation's maximum height |
| `density.generatorWidthPx`     | `--tc-generator-width` | `w-generator`          | 640 px             | The SQL Generator dialog             |

## Query history and Services

Plan 011. An outcome is drawn in one of two sizes from `ui/Outcome.tsx`, on the shell's colours:

| Outcome   | `OutcomeDot` (history list, 8 px `rounded-full`) | `OutcomeGlyph` (Services, `size-icon`)        |
| --------- | ------------------------------------------------ | --------------------------------------------- |
| running   |                                                  | `SpinnerIcon`, spinning, `text-accent`        |
| success   | `bg-success`                                     | `SuccessIcon` (`CheckCircle`), `text-success` |
| error     | `bg-danger`                                      | `ErrorIcon` (`XCircle`), `text-danger`        |
| cancelled | `bg-warning`                                     | `CancelledIcon` (`Prohibit`), `text-warning`  |

`ui/ListPicker.tsx` draws Query History and Open Closed Console as a modal like the others, wider:
the title, a search field, a `listbox` of `h-row` options on `bg-canvas` in a `border-line` frame
(the selected one `bg-selection`, the rest `hover:bg-raised`), the preview, then the buttons right
aligned with the primary last before Close and a destructive one (`Clear History…`, `Delete…`) in
the danger style. A history row reads the outcome dot, the first line in `font-editor text-editor`,
then `×3`, rows, duration and time in `text-ink-muted tabular-nums`; the preview is the read-only
`ui/SqlView.tsx`, `h-picker-list`, with an error message above it in `text-danger`. A closed
console's row is `ConsoleIcon` in `text-ink-muted` and its name. The actions' icons are
`ClockCounterClockwise` (Query History) and `FolderOpen` (Open Closed Console).

| Token (`appearance/tokens.ts`) | CSS variable              | Tailwind        | Dark / comfortable | Used by                                       |
| ------------------------------ | ------------------------- | --------------- | ------------------ | --------------------------------------------- |
| `density.pickerWidthPx`        | `--tc-picker-width`       | `w-picker`      | 720 px             | Query History and Open Closed Console dialogs |
| `density.pickerListHeightPx`   | `--tc-picker-list-height` | `h-picker-list` | 220 px             | The picker's list and its preview             |

The Services tree reuses the Database tool window's rows (`h-row`, 16 px indent per level, a caret
for expandable rows, `bg-selection` selected, `hover:bg-raised`). A datasource row is `DatabaseIcon`
in `text-accent` (`text-danger` failed), the name and its connection state muted. A session row is
the `Terminal` or `Table` glyph in `text-ink-muted`, a spinning `SpinnerIcon` in `text-accent`
while running, the tab's title, its state
(`text-accent` running, `text-danger` failed, else `text-ink-muted`) and the last duration right
aligned. An execution row is its `OutcomeGlyph`, the label in `font-editor text-editor` with the
error message as its tooltip, then rows, duration (elapsed while running) and start time right
aligned in `text-ink-muted tabular-nums`. The session's context menu is the tab context menu's
`bg-raised` panel.

## Plan view

Plan 012. A plan tab (`console/PlanView.tsx`) fills the result area. An analysed plan starts with
a banner: `bg-analysed-banner`, a `border-line` rule under it, a filled `WarningIcon` in
`text-warning`, then the text in `text-ink`. Under it an `h-row` toolbar on `bg-panel`: a segmented
Tree / Raw group in a `border-line` frame (the shown view `bg-selection`), icon-only
`ArrowClockwise` Explain Again and `CopySimple` Copy Raw Plan, then the summary (`Planning Time: 1.0 ms ·
Execution Time: 0.1 ms`) in `text-ink-muted`, truncated.

The tree is a `<table role="treegrid">` on `bg-canvas` in `font-grid text-grid`, rows `h-row`, a
sticky `bg-panel` header in `text-ink-muted`. The Operation column takes the room left over and
truncates, with the whole text as the tooltip; it indents 16 px per level with the Database pane's
`CaretDown`/`CaretRight` and shows the target in `text-ink-muted`. The number columns are as narrow
as their content, right-aligned, empty for a value the database did not give. The Cost cell, or
the Time cell when analysed, carries an `h-plan-bar` `bg-plan-bar` bar along its bottom edge, as
wide as the node's share of the root's. The selected row is `bg-selection`, the rest
`hover:bg-raised`. To the right a `w-plan-details` strip on `bg-panel` behind a `border-line` edge
lists the selected node: the operation in semibold with its target muted, then `Detail` and each
property as a two-column list, names in `text-ink-muted`, values in `font-grid`, wrapping. Raw is
the read-only `ui/SqlView.tsx` on `bg-canvas`, unhighlighted.

| Token (`appearance/tokens.ts`) | CSS variable              | Tailwind             | Dark / comfortable | Used by                                       |
| ------------------------------ | ------------------------- | -------------------- | ------------------ | --------------------------------------------- |
| `colors.planBar`               | `--tc-plan-bar`           | `bg-plan-bar`        | `#4f80c9`          | The share bar in the Cost or Time cell        |
| `colors.analysedBanner`        | `--tc-analysed-banner`    | `bg-analysed-banner` | `#4a3d22`          | The `Explain Analyse ran this statement.` bar |
| `density.planDetailsWidthPx`   | `--tc-plan-details-width` | `w-plan-details`     | 320 px             | The node details strip                        |
| `density.planBarHeightPx`      | `--tc-plan-bar-height`    | `h-plan-bar`         | 3 px               | The share bar's thickness                     |

## Datasource colours

Plan 004. A datasource stores its colour by name (decision 011); the theme gives the value. The
name picks the classes in `renderer/ui/tint.ts`: the swatch is `bg-ds-<name>`, the tab background
`bg-ds-<name>/25`, the console editor's border `border-2 border-ds-<name>` (plan 006).

| Token (`colors.datasource.*`) | CSS variable     | Tailwind    | Dark      |
| ----------------------------- | ---------------- | ----------- | --------- |
| `red`                         | `--tc-ds-red`    | `ds-red`    | `#c75450` |
| `orange`                      | `--tc-ds-orange` | `ds-orange` | `#d08b46` |
| `yellow`                      | `--tc-ds-yellow` | `ds-yellow` | `#c9ae4a` |
| `green`                       | `--tc-ds-green`  | `ds-green`  | `#5e9f62` |
| `blue`                        | `--tc-ds-blue`   | `ds-blue`   | `#4f80c9` |
| `violet`                      | `--tc-ds-violet` | `ds-violet` | `#9670c7` |
