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

The toolbar reads left to right: Run (primary), Run All, Cancel when the plugin can cancel, then
the transaction controls when it declares `transactions`: a `Tx: Auto` / `Tx: Manual` select,
Commit (`Check`), Rollback (`ArrowCounterClockwise`) and the `transaction open` badge in
`bg-warning text-canvas`. Run All is `FastForward`. Toolbar buttons never wrap (`shrink-0
whitespace-nowrap`); a long error gives way instead.

Below the editor, the result strip holds `Output` and then `Result 1`, `Result 2`…, each with a
`PushPin` that fills when pinned. The Output log is `font-editor`: the time and the statement's
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
