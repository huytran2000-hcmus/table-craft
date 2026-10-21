import type { ExtractorKind, SortDirection } from "@table-craft/desktop/engine/protocol.js";
import type { ActionContext } from "@table-craft/desktop/renderer/actions/context.js";
import { defineAction, type AnyAction } from "@table-craft/desktop/renderer/actions/registry.js";
import { bridge } from "@table-craft/desktop/renderer/bridge.js";
import { allShown, hiddenColumn, visibleColumns } from "@table-craft/desktop/renderer/model/columnLayout.js";
import { formatCount } from "@table-craft/desktop/renderer/model/format.js";
import { rowCountOf, selectAll, selectedRanges } from "@table-craft/desktop/renderer/model/gridSelection.js";
import { cycledSort, sortedBy } from "@table-craft/desktop/renderer/model/sortKeys.js";
import { canFetch, canRun, useConsoles, type ResultTab } from "@table-craft/desktop/renderer/state/consoles.js";
import { useLayout } from "@table-craft/desktop/renderer/state/layout.js";
import { useModal } from "@table-craft/desktop/renderer/state/modal.js";

export const GRID_ACTION_IDS = {
  fetchNextPage: "grid.fetchNextPage",
  fetchAll: "grid.fetchAll",
  cancelFetch: "grid.cancelFetch",
  rerun: "grid.rerun",
  copy: "grid.copy",
  selectAll: "grid.selectAll",
  export: "grid.export",
  toggleValuePanel: "grid.toggleValuePanel",
  setExtractor: "grid.setExtractor",
  sort: "grid.sort",
  clearSort: "grid.clearSort",
  hideColumn: "grid.hideColumn",
  showAllColumns: "grid.showAllColumns",
  copyColumnName: "grid.copyColumnName",
} as const;

/** Above this many selected rows Copy is off: the clipboard is the wrong place, Export is the right one. */
export const MAX_COPY_ROWS = 100_000;

export const EXTRACTOR_LABELS: Readonly<Record<ExtractorKind, string>> = {
  csv: "CSV",
  tsv: "TSV",
  json: "JSON",
  sqlInsert: "SQL Inserts",
  markdown: "Markdown",
};

const EXTRACTOR_EXTENSIONS: Readonly<Record<ExtractorKind, string>> = {
  csv: "csv",
  tsv: "tsv",
  json: "json",
  sqlInsert: "sql",
  markdown: "md",
};

/** A header menu entry names its column by result index. */
export interface ColumnArgs {
  readonly column: number;
}

/** A header click: `add` (⌥-click) makes it a further key; `direction` sets it rather than cycling. */
export interface SortArgs extends ColumnArgs {
  readonly add?: boolean;
  readonly direction?: SortDirection;
}

export interface ExtractorArgs {
  readonly extractor: ExtractorKind;
}

interface ShownResult {
  readonly consoleId: string;
  readonly result: ResultTab;
}

function shown(context: ActionContext): ShownResult | null {
  if (context.console === null || context.activeTab === null || context.result === null) return null;
  return { consoleId: context.activeTab.id, result: context.result };
}

function live(context: ActionContext): ShownResult | null {
  const target = shown(context);
  return target === null || target.result.stale ? null : target;
}

/** The column a header menu named, or from the palette the focused cell's column. */
function columnOf(result: ResultTab, args: Partial<ColumnArgs> | undefined): number | null {
  const column = args?.column ?? visibleColumns(result.layout)[result.selection?.focus.column ?? -1];
  if (column === undefined || !Number.isInteger(column) || column < 0 || column >= result.columns.length) return null;
  return column;
}

/** Why Copy is off for the selection, or null when it can run. */
export function copyBlockedReason(result: ResultTab | null): string | null {
  if (result === null || result.selection === null) return "Select cells to copy";
  if (result.stale) return "Rerun to copy from a closed connection's results";
  if (rowCountOf(result.selection) > MAX_COPY_ROWS) {
    return `Copy takes at most ${formatCount(MAX_COPY_ROWS)} rows; use Export`;
  }
  return null;
}

async function writeClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export function defaultExportName(title: string, extractor: ExtractorKind): string {
  return `${title}.${EXTRACTOR_EXTENSIONS[extractor]}`;
}

export const GRID_ACTIONS: readonly AnyAction[] = [
  defineAction({
    id: GRID_ACTION_IDS.fetchNextPage,
    title: "Fetch Next Page",
    category: "Result Grid",
    icon: "fetchNextPage",
    when: (context) => {
      const target = live(context);
      return target !== null && canFetch(target.result);
    },
    run: async (context) => {
      const target = live(context);
      if (target !== null) await useConsoles.getState().fetchMore(target.consoleId, target.result.id, false);
    },
  }),
  defineAction({
    id: GRID_ACTION_IDS.fetchAll,
    title: "Fetch All",
    category: "Result Grid",
    icon: "fetchAll",
    when: (context) => {
      const target = live(context);
      return target !== null && canFetch(target.result);
    },
    run: async (context) => {
      const target = live(context);
      if (target !== null) await useConsoles.getState().fetchMore(target.consoleId, target.result.id, true);
    },
  }),
  defineAction({
    id: GRID_ACTION_IDS.cancelFetch,
    title: "Cancel Fetch",
    category: "Result Grid",
    icon: "cancel",
    when: (context) => {
      const fetching = live(context)?.result.fetching;
      return fetching === "page" || fetching === "all";
    },
    run: async (context) => {
      const target = live(context);
      if (target !== null) await useConsoles.getState().stopFetch(target.consoleId, target.result.id);
    },
  }),
  defineAction({
    id: GRID_ACTION_IDS.rerun,
    title: "Rerun",
    category: "Result Grid",
    icon: "rerun",
    shortcut: "Mod+R",
    shortcutRegion: "grid",
    when: (context) => shown(context) !== null && context.console !== null && canRun(context.console.status),
    run: async (context) => {
      const target = shown(context);
      if (target !== null) await useConsoles.getState().rerun(target.consoleId, target.result.id);
    },
  }),
  defineAction({
    id: GRID_ACTION_IDS.copy,
    title: "Copy",
    category: "Result Grid",
    icon: "copy",
    shortcut: "Mod+C",
    shortcutRegion: "grid",
    when: (context) => copyBlockedReason(context.result) === null,
    run: async (context) => {
      const target = live(context);
      const selection = target?.result.selection ?? null;
      if (target === null || selection === null) return;
      const { rows, columns } = selectedRanges(selection, visibleColumns(target.result.layout));
      const { extractor } = useLayout.getState().layout;
      const text = await useConsoles.getState().extract(target.consoleId, target.result.id, extractor, rows, columns);
      if (text !== null) await writeClipboard(text);
    },
  }),
  defineAction({
    id: GRID_ACTION_IDS.selectAll,
    title: "Select All Rows",
    category: "Result Grid",
    shortcut: "Mod+A",
    shortcutRegion: "grid",
    when: (context) => shown(context) !== null && (context.result?.rowCount ?? 0) > 0,
    run: (context) => {
      const target = shown(context);
      if (target === null) return;
      const { result } = target;
      const bounds = { rows: result.rowCount, columns: visibleColumns(result.layout).length };
      useConsoles.getState().select(target.consoleId, result.id, selectAll(bounds));
    },
  }),
  defineAction({
    id: GRID_ACTION_IDS.export,
    title: "Export Data…",
    category: "Result Grid",
    icon: "export",
    when: (context) => {
      const target = live(context);
      return target !== null && target.result.fetching === null;
    },
    run: async (context) => {
      const target = live(context);
      if (target === null) return;
      const { extractor } = useLayout.getState().layout;
      const chosen = await bridge().saveFile("Export Data", defaultExportName(target.result.title, extractor));
      if (!chosen.ok) {
        await useModal.getState().ask({ kind: "notice", title: "Could not export", ...chosen.error });
        return;
      }
      if (chosen.value === null) return;
      const columns = visibleColumns(target.result.layout);
      await useConsoles.getState().exportTo(target.consoleId, target.result.id, extractor, chosen.value, columns);
    },
  }),
  defineAction({
    id: GRID_ACTION_IDS.toggleValuePanel,
    title: "Value Panel",
    category: "Result Grid",
    icon: "valuePanel",
    shortcut: "Shift+Enter",
    shortcutRegion: "grid",
    when: (context) => shown(context) !== null,
    run: () => useLayout.getState().toggleValuePanel(),
  }),
  defineAction<ExtractorArgs | undefined>({
    id: GRID_ACTION_IDS.setExtractor,
    title: "Choose Extractor",
    category: "Result Grid",
    run: (_context, args) => {
      if (args !== undefined) useLayout.getState().setExtractor(args.extractor);
    },
  }),
  defineAction<SortArgs | undefined>({
    id: GRID_ACTION_IDS.sort,
    title: "Sort",
    category: "Result Grid",
    icon: "sortAscending",
    when: (context) => live(context) !== null,
    run: async (context, args) => {
      const target = live(context);
      const column = target === null ? null : columnOf(target.result, args);
      if (target === null || column === null) return;
      const keys =
        args?.direction === undefined
          ? cycledSort(target.result.sort, column, args?.add === true)
          : sortedBy(column, args.direction);
      await useConsoles.getState().sort(target.consoleId, target.result.id, keys);
    },
  }),
  defineAction({
    id: GRID_ACTION_IDS.clearSort,
    title: "Clear Sort",
    category: "Result Grid",
    when: (context) => (live(context)?.result.sort.length ?? 0) > 0,
    run: async (context) => {
      const target = live(context);
      if (target !== null) await useConsoles.getState().sort(target.consoleId, target.result.id, []);
    },
  }),
  defineAction<ColumnArgs | undefined>({
    id: GRID_ACTION_IDS.hideColumn,
    title: "Hide Column",
    category: "Result Grid",
    icon: "hide",
    when: (context) => visibleColumns(context.result?.layout ?? { widths: [], hidden: [] }).length > 1,
    run: (context, args) => {
      const target = shown(context);
      const column = target === null ? null : columnOf(target.result, args);
      if (target === null || column === null) return;
      const layout = hiddenColumn(target.result.layout, column);
      useConsoles.getState().setLayout(target.consoleId, target.result.id, layout);
    },
  }),
  defineAction({
    id: GRID_ACTION_IDS.showAllColumns,
    title: "Show All Columns",
    category: "Result Grid",
    when: (context) => context.result?.layout.hidden.includes(true) === true,
    run: (context) => {
      const target = shown(context);
      if (target === null) return;
      useConsoles.getState().setLayout(target.consoleId, target.result.id, allShown(target.result.layout));
    },
  }),
  defineAction<ColumnArgs | undefined>({
    id: GRID_ACTION_IDS.copyColumnName,
    title: "Copy Column Name",
    category: "Result Grid",
    icon: "copy",
    when: (context) => shown(context) !== null,
    run: async (context, args) => {
      const target = shown(context);
      const index = target === null ? null : columnOf(target.result, args);
      const column = index === null ? undefined : target?.result.columns[index];
      if (column !== undefined) await writeClipboard(column.name);
    },
  }),
];
