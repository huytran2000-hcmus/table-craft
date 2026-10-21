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

## Datasource colours

Plan 004. A datasource stores its colour by name (decision 011); the theme gives the value. The
name picks the classes in `renderer/ui/tint.ts`: the swatch is `bg-ds-<name>`, the tab background
`bg-ds-<name>/25`, the console border `border-2 border-ds-<name>`.

| Token (`colors.datasource.*`) | CSS variable     | Tailwind    | Dark      |
| ----------------------------- | ---------------- | ----------- | --------- |
| `red`                         | `--tc-ds-red`    | `ds-red`    | `#c75450` |
| `orange`                      | `--tc-ds-orange` | `ds-orange` | `#d08b46` |
| `yellow`                      | `--tc-ds-yellow` | `ds-yellow` | `#c9ae4a` |
| `green`                       | `--tc-ds-green`  | `ds-green`  | `#5e9f62` |
| `blue`                        | `--tc-ds-blue`   | `ds-blue`   | `#4f80c9` |
| `violet`                      | `--tc-ds-violet` | `ds-violet` | `#9670c7` |
