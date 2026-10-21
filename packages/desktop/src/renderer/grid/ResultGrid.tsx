import * as ContextMenu from "@radix-ui/react-context-menu";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import {
  RESULT_WINDOW_ROWS,
  type SortDirection,
  type TypeClass,
  type WireValue,
} from "@table-craft/desktop/engine/protocol.js";
import { currentPlatform, formatChord } from "@table-craft/desktop/renderer/actions/chords.js";
import { REGION_ATTRIBUTE } from "@table-craft/desktop/renderer/actions/context.js";
import { GRID_ACTION_IDS, type SortArgs } from "@table-craft/desktop/renderer/actions/gridActions.js";
import { invoke, registry, useActionEnabled } from "@table-craft/desktop/renderer/actions/index.js";
import { DEFAULT_APPEARANCE } from "@table-craft/desktop/renderer/appearance/tokens.js";
import { formatCell, NULL_TEXT } from "@table-craft/desktop/renderer/grid/format.js";
import { GridToolbar } from "@table-craft/desktop/renderer/grid/GridToolbar.js";
import { ValuePanel } from "@table-craft/desktop/renderer/grid/ValuePanel.js";
import { displayChars } from "@table-craft/desktop/renderer/grid/widths.js";
import {
  columnTemplate,
  fittedTo,
  resizedTo,
  visibleColumns,
} from "@table-craft/desktop/renderer/model/columnLayout.js";
import {
  contains,
  extendTo,
  moveBy,
  rectOf,
  selectCell,
  selectColumn,
  selectRows,
  type Cell,
  type GridBounds,
} from "@table-craft/desktop/renderer/model/gridSelection.js";
import { sortMarkOf } from "@table-craft/desktop/renderer/model/sortKeys.js";
import { rowAt, useConsoles, windowOffsetOf, type ResultTab } from "@table-craft/desktop/renderer/state/consoles.js";
import { useLayout } from "@table-craft/desktop/renderer/state/layout.js";
import { cn } from "@table-craft/desktop/renderer/ui/cn.js";
import { SortAscendingMark, SortDescendingMark, TYPE_GLYPHS } from "@table-craft/desktop/renderer/ui/icons.js";

const OVERSCAN_ROWS = 20;
const ROW_HEIGHT_PX = DEFAULT_APPEARANCE.density.rowHeightPx;
const MIN_GUTTER_DIGITS = 2;
const STALE_TEXT = "Results from a closed connection; rerun to refresh";
const CELL = "truncate border-r border-line px-cell leading-(--spacing-row)";

const GLYPH_OF: Readonly<Record<TypeClass, keyof typeof TYPE_GLYPHS>> = {
  integer: "number",
  float: "number",
  decimal: "number",
  boolean: "bool",
  temporal: "date",
  json: "json",
  bytes: "bytes",
  text: "text",
};

const NUMERIC: ReadonlySet<TypeClass> = new Set(["integer", "float", "decimal"]);

/** The result grid: toolbar, rows, and the value panel beside them (plan 007). */
export function ResultGrid({ consoleId, result }: { readonly consoleId: string; readonly result: ResultTab }) {
  const valuePanel = useLayout((state) => state.layout.valuePanel);
  const visible = useMemo(() => visibleColumns(result.layout), [result.layout]);
  const focus = result.selection?.focus ?? null;
  const focusColumn = focus === null ? undefined : visible[focus.column];
  const focusValue =
    focus === null || focusColumn === undefined ? undefined : rowAt(result.windows, focus.row)?.[focusColumn];
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-loaded-windows={Object.keys(result.windows).length}
      data-stale={result.stale}
    >
      <GridToolbar result={result} />
      {result.stale ? (
        <div
          role="status"
          className="h-row shrink-0 border-b border-line bg-panel px-gap leading-(--spacing-row) text-ink-muted italic"
        >
          {STALE_TEXT}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <Rows key={result.handle} consoleId={consoleId} result={result} visible={visible} />
        {valuePanel ? (
          <ValuePanel
            column={focusColumn === undefined ? null : (result.columns[focusColumn] ?? null)}
            value={focusValue}
          />
        ) : null}
      </div>
    </div>
  );
}

interface RowsProps {
  readonly consoleId: string;
  readonly result: ResultTab;
  /** Result column indices in drawing order. */
  readonly visible: readonly number[];
}

function cellOf(target: EventTarget): Cell | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest("[data-row][data-col]");
  if (element === null) return null;
  return { row: Number(element.getAttribute("data-row")), column: Number(element.getAttribute("data-col")) };
}

function Rows({ consoleId, result, visible }: RowsProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const { rowCount, windows, selection } = result;
  const bounds: GridBounds = { rows: rowCount, columns: visible.length };
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: OVERSCAN_ROWS,
  });
  const items = virtualizer.getVirtualItems();
  const first = items[0]?.index;
  const last = items.at(-1)?.index;

  useEffect(() => {
    if (first === undefined || last === undefined) return;
    const { ensureWindow } = useConsoles.getState();
    for (let offset = windowOffsetOf(first); offset <= last; offset += RESULT_WINDOW_ROWS) {
      ensureWindow(consoleId, result.id, offset);
    }
  }, [consoleId, result.id, first, last, windows]);

  useEffect(() => {
    const stop = () => {
      dragging.current = false;
    };
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  const select = (next: ResultTab["selection"]) => useConsoles.getState().select(consoleId, result.id, next);

  function reveal(cell: Cell): void {
    virtualizer.scrollToIndex(cell.row, { align: "auto" });
    const container = scroller.current;
    const header = container?.querySelector<HTMLElement>(`[data-header-col="${String(cell.column)}"]`);
    const gutter = container?.querySelector<HTMLElement>("[data-gutter-header]");
    if (container == null || header == null) return;
    const left = header.offsetLeft - (gutter?.offsetWidth ?? 0);
    const right = header.offsetLeft + header.offsetWidth;
    if (left < container.scrollLeft) container.scrollLeft = left;
    else if (right > container.scrollLeft + container.clientWidth) container.scrollLeft = right - container.clientWidth;
  }

  function onMouseDown(event: MouseEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    const cell = cellOf(event.target);
    if (cell === null) return;
    dragging.current = true;
    select(event.shiftKey && selection !== null ? extendTo(selection, cell) : selectCell(cell));
  }

  function onMouseOver(event: MouseEvent<HTMLDivElement>): void {
    if (!dragging.current || (event.buttons & 1) === 0) return;
    const cell = cellOf(event.target);
    if (cell === null || selection === null) return;
    if (cell.row !== selection.focus.row || cell.column !== selection.focus.column) select(extendTo(selection, cell));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.metaKey || event.ctrlKey || event.altKey || rowCount === 0 || visible.length === 0) return;
    const page = Math.max(Math.floor((scroller.current?.clientHeight ?? ROW_HEIGHT_PX) / ROW_HEIGHT_PX) - 1, 1);
    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      PageUp: [-page, 0],
      PageDown: [page, 0],
      Home: [0, -visible.length],
      End: [0, visible.length],
    };
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    const from = selection ?? selectCell({ row: 0, column: 0 });
    const next = selection === null ? from : moveBy(from, move[0], move[1], bounds, event.shiftKey);
    select(next);
    reveal(next.focus);
  }

  const gutterDigits = Math.max(String(rowCount).length, MIN_GUTTER_DIGITS);
  const template = `calc(${String(gutterDigits)}ch + 2 * var(--spacing-cell)) ${columnTemplate(result.layout, result.autoChars)}`;
  const rect = selection === null ? null : rectOf(selection);

  return (
    <div
      ref={scroller}
      role="grid"
      aria-label={result.title}
      aria-rowcount={rowCount + 1}
      aria-colcount={visible.length}
      aria-multiselectable
      tabIndex={0}
      {...{ [REGION_ATTRIBUTE]: "grid" }}
      className="min-h-0 min-w-0 flex-1 overflow-auto font-grid text-grid outline-none select-none"
      onKeyDown={onKeyDown}
    >
      <div
        role="row"
        className="sticky top-0 z-20 grid h-row w-max min-w-full border-b border-line bg-panel"
        style={{ gridTemplateColumns: template }}
      >
        <div data-gutter-header className="sticky left-0 z-30 border-r border-line bg-panel" />
        {visible.map((column, position) => (
          <HeaderCell
            key={column}
            consoleId={consoleId}
            result={result}
            column={column}
            position={position}
            bounds={bounds}
            select={select}
          />
        ))}
      </div>
      <div
        role="rowgroup"
        className="relative"
        style={{ height: virtualizer.getTotalSize() }}
        onMouseDown={onMouseDown}
        onMouseOver={onMouseOver}
      >
        {items.map((item) => {
          const row = rowAt(windows, item.index);
          const selectedRow = rect !== null && item.index >= rect.top && item.index <= rect.bottom;
          return (
            <div
              key={item.key}
              role="row"
              aria-rowindex={item.index + 2}
              className={cn("absolute left-0 grid h-row w-max min-w-full", item.index % 2 === 1 && "bg-grid-stripe")}
              style={{ gridTemplateColumns: template, transform: `translateY(${String(item.start)}px)` }}
            >
              <div
                role="rowheader"
                className={cn(
                  "sticky left-0 z-10 border-r border-line bg-panel px-cell text-right leading-(--spacing-row) text-ink-muted",
                  selectedRow && "text-ink",
                )}
                onMouseDown={(event) => {
                  if (event.button !== 0) return;
                  event.stopPropagation();
                  const from = event.shiftKey && selection !== null ? selection.anchor.row : undefined;
                  select(selectRows(item.index, bounds, from));
                }}
              >
                {item.index + 1}
              </div>
              {visible.map((column, position) => (
                <GridCell
                  key={column}
                  value={row?.[column]}
                  row={item.index}
                  position={position}
                  numeric={NUMERIC.has(result.typeClasses[column] ?? "text")}
                  selected={rect !== null && contains(rect, item.index, position)}
                  focused={selection?.focus.row === item.index && selection.focus.column === position}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GridCell({
  value,
  row,
  position,
  numeric,
  selected,
  focused,
}: {
  readonly value: WireValue | undefined;
  readonly row: number;
  readonly position: number;
  readonly numeric: boolean;
  readonly selected: boolean;
  readonly focused: boolean;
}) {
  return (
    <div
      role="gridcell"
      data-row={row}
      data-col={position}
      aria-selected={selected}
      data-null={value === null ? true : undefined}
      className={cn(
        CELL,
        numeric && "text-right",
        selected && "bg-grid-selection",
        focused && "outline outline-1 -outline-offset-1 outline-accent",
        value === null && "text-grid-null italic",
      )}
    >
      {value === undefined ? "…" : value === null ? NULL_TEXT : formatCell(value)}
    </div>
  );
}

function SortMark({
  direction,
  position,
  several,
}: {
  readonly direction: SortDirection;
  readonly position: number;
  readonly several: boolean;
}) {
  const Mark = direction === "asc" ? SortAscendingMark : SortDescendingMark;
  return (
    <span data-sort={direction} className="flex shrink-0 items-center text-accent">
      <Mark aria-label={direction === "asc" ? "ascending" : "descending"} className="size-icon" />
      {several ? <span data-sort-position>{position}</span> : null}
    </span>
  );
}

interface HeaderCellProps {
  readonly consoleId: string;
  readonly result: ResultTab;
  readonly column: number;
  readonly position: number;
  readonly bounds: GridBounds;
  readonly select: (selection: ResultTab["selection"]) => void;
}

function HeaderCell({ consoleId, result, column, position, bounds, select }: HeaderCellProps) {
  const name = result.columns[column]?.name ?? "";
  const type = result.columns[column]?.type ?? null;
  const Glyph = TYPE_GLYPHS[GLYPH_OF[result.typeClasses[column] ?? "text"]];
  const mark = sortMarkOf(result.sort, column);
  const resizing = useRef<{ readonly x: number; readonly width: number } | null>(null);

  function setLayout(layout: ResultTab["layout"]): void {
    useConsoles.getState().setLayout(consoleId, result.id, layout);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>): void {
    event.stopPropagation();
    event.preventDefault();
    const cell = event.currentTarget.parentElement;
    if (cell === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    resizing.current = { x: event.clientX, width: cell.getBoundingClientRect().width };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>): void {
    const start = resizing.current;
    if (start === null) return;
    setLayout(resizedTo(result.layout, column, start.width + event.clientX - start.x));
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>): void {
    resizing.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function fit(): void {
    let widest = displayChars(name);
    for (const rows of Object.values(result.windows)) {
      for (const row of rows) widest = Math.max(widest, displayChars(formatCell(row[column] ?? null)));
    }
    setLayout(fittedTo(result.layout, column, widest));
  }

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          role="columnheader"
          data-header-col={position}
          data-column-name={name}
          aria-sort={mark === null ? "none" : mark.direction === "asc" ? "ascending" : "descending"}
          title={`${name}: ${type ?? "unknown"}`}
          className="relative flex min-w-0 cursor-default items-center gap-1 overflow-hidden border-r border-line px-cell text-ink"
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey) {
              select(selectColumn(position, bounds));
              return;
            }
            const args: SortArgs = { column, add: event.altKey };
            invoke(GRID_ACTION_IDS.sort, args);
          }}
        >
          <Glyph aria-hidden className="size-icon shrink-0 text-ink-muted" />
          <span className="truncate">{name}</span>
          {mark === null ? null : (
            <SortMark direction={mark.direction} position={mark.position} several={result.sort.length > 1} />
          )}
          <div
            aria-hidden
            data-resize-handle
            className="absolute top-0 right-0 z-10 h-full w-2 cursor-col-resize"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => {
              event.stopPropagation();
              fit();
            }}
          />
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-48 rounded border border-line bg-raised p-1 text-ui text-ink shadow-lg">
          <MenuItem actionId={GRID_ACTION_IDS.sort} label="Sort Ascending" args={{ column, direction: "asc" }} />
          <MenuItem actionId={GRID_ACTION_IDS.sort} label="Sort Descending" args={{ column, direction: "desc" }} />
          <MenuItem actionId={GRID_ACTION_IDS.clearSort} />
          <ContextMenu.Separator className="my-1 h-px bg-line" />
          <MenuItem actionId={GRID_ACTION_IDS.hideColumn} args={{ column }} />
          <MenuItem actionId={GRID_ACTION_IDS.showAllColumns} />
          <ContextMenu.Separator className="my-1 h-px bg-line" />
          <MenuItem actionId={GRID_ACTION_IDS.copyColumnName} args={{ column }} />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function MenuItem({
  actionId,
  label,
  args,
}: {
  readonly actionId: string;
  readonly label?: string;
  readonly args?: unknown;
}) {
  const enabled = useActionEnabled(actionId);
  const action = registry.get(actionId);
  if (action === undefined) return null;
  return (
    <ContextMenu.Item
      disabled={!enabled}
      className="flex h-row cursor-default items-center justify-between gap-gap rounded px-gap outline-none data-[disabled]:text-ink-muted data-[highlighted]:bg-selection"
      onSelect={() => invoke(actionId, args)}
    >
      <span>{label ?? action.title}</span>
      {action.shortcut === undefined ? null : (
        <span className="text-ink-muted">{formatChord(action.shortcut, currentPlatform())}</span>
      )}
    </ContextMenu.Item>
  );
}
