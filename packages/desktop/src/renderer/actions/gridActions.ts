import type { ExtractorKind, SortDirection } from "@table-craft/desktop/engine/protocol.js";
import type { ActionContext } from "@table-craft/desktop/renderer/actions/context.js";
import { defineAction, type AnyAction } from "@table-craft/desktop/renderer/actions/registry.js";
import { askExport } from "@table-craft/desktop/renderer/actions/exportActions.js";
import { allShown, hiddenColumn, visibleColumns } from "@table-craft/desktop/renderer/model/columnLayout.js";
import { formatCount } from "@table-craft/desktop/renderer/model/format.js";
import { rowCountOf, selectAll, selectedRanges } from "@table-craft/desktop/renderer/model/gridSelection.js";
import { cycledSort, sortedBy } from "@table-craft/desktop/renderer/model/sortKeys.js";
import { canFetch, canRun, useConsoles, type ResultTab } from "@table-craft/desktop/renderer/state/consoles.js";
import { canReload, tableRowCount, useTables } from "@table-craft/desktop/renderer/state/tables.js";
import { reloadTable, settlePendingEdits } from "@table-craft/desktop/renderer/actions/tableCommands.js";
import { useLayout } from "@table-craft/desktop/renderer/state/layout.js";

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

const EXPORT_RESULT_NOTE =
  "Every row of the result. A read runs again on a connection of its own; anything else exports the rows this result holds and fetches.";

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

/** What the grid's actions ask of the store holding the shown result; consoles and tables share it. */
type ResultHost = Pick<
  ReturnType<typeof useConsoles.getState>,
  "fetchMore" | "stopFetch" | "sort" | "setLayout" | "select" | "extract" | "exportTo"
>;

interface ShownResult {
  /** The console or table tab showing the result. */
  readonly ownerId: string;
  readonly result: ResultTab;
  readonly host: ResultHost;
  /** Rows the grid draws, the table editor's added ones included. */
  readonly rows: number;
}

function shown(context: ActionContext): ShownResult | null {
  if (context.activeTab === null || context.result === null) return null;
  const ownerId = context.activeTab.id;
  if (context.console !== null) {
    return { ownerId, result: context.result, host: useConsoles.getState(), rows: context.result.rowCount };
  }
  if (context.table !== null) {
    return { ownerId, result: context.result, host: useTables.getState(), rows: tableRowCount(context.table) };
  }
  return null;
}

/** Whether Rerun can start: a console's Run or a table's Reload. */
function canRerun(context: ActionContext): boolean {
  if (shown(context) === null) return false;
  if (context.console !== null) return canRun(context.console.status);
  return context.table !== null && canReload(context.table.status);
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
      if (target !== null) await target.host.fetchMore(target.ownerId, target.result.id, false);
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
      if (target !== null) await target.host.fetchMore(target.ownerId, target.result.id, true);
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
      if (target !== null) await target.host.stopFetch(target.ownerId, target.result.id);
    },
  }),
  defineAction({
    id: GRID_ACTION_IDS.rerun,
    title: "Rerun",
    category: "Result Grid",
    icon: "rerun",
    shortcut: "Mod+R",
    shortcutRegion: "grid",
    when: canRerun,
    run: async (context) => {
      const target = shown(context);
      if (target === null) return;
      if (context.table !== null) await reloadTable(target.ownerId);
      else await useConsoles.getState().rerun(target.ownerId, target.result.id);
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
      // Rows added in the table editor are not in the engine yet; Copy takes the held ones.
      const held = rows.flatMap((range) =>
        range.from >= target.result.rowCount
          ? []
          : [{ from: range.from, to: Math.min(range.to, target.result.rowCount) }],
      );
      if (held.length === 0) return;
      const { extractor } = useLayout.getState().layout;
      const text = await target.host.extract(target.ownerId, target.result.id, extractor, held, columns);
      if (text !== null) await writeClipboard(text);
    },
  }),
  defineAction({
    id: GRID_ACTION_IDS.selectAll,
    title: "Select All Rows",
    category: "Result Grid",
    shortcut: "Mod+A",
    shortcutRegion: "grid",
    when: (context) => (shown(context)?.rows ?? 0) > 0,
    run: (context) => {
      const target = shown(context);
      if (target === null) return;
      const { result } = target;
      const bounds = { rows: target.rows, columns: visibleColumns(result.layout).length };
      target.host.select(target.ownerId, result.id, selectAll(bounds));
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
      const { result } = target;
      const choice = await askExport({
        name: result.title,
        columns: result.columns.map((column) => column.name),
        chosen: visibleColumns(result.layout),
        note: EXPORT_RESULT_NOTE,
      });
      if (choice === null) return;
      await target.host.exportTo(target.ownerId, result.id, choice.format, choice.path, choice.columns);
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
      if (context.table !== null && !(await settlePendingEdits([target.ownerId], "sort"))) return;
      await target.host.sort(target.ownerId, target.result.id, keys);
    },
  }),
  defineAction({
    id: GRID_ACTION_IDS.clearSort,
    title: "Clear Sort",
    category: "Result Grid",
    when: (context) => (live(context)?.result.sort.length ?? 0) > 0,
    run: async (context) => {
      const target = live(context);
      if (target === null) return;
      if (context.table !== null && !(await settlePendingEdits([target.ownerId], "sort"))) return;
      await target.host.sort(target.ownerId, target.result.id, []);
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
      target.host.setLayout(target.ownerId, target.result.id, layout);
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
      target.host.setLayout(target.ownerId, target.result.id, allShown(target.result.layout));
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
