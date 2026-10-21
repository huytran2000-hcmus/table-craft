import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef } from "react";
import { RESULT_WINDOW_ROWS } from "@table-craft/desktop/engine/protocol.js";
import { DEFAULT_APPEARANCE } from "@table-craft/desktop/renderer/appearance/tokens.js";
import { formatCell } from "@table-craft/desktop/renderer/grid/format.js";
import { columnChars, columnTemplate } from "@table-craft/desktop/renderer/grid/widths.js";
import { rowAt, useConsoles, windowOffsetOf, type ResultTab } from "@table-craft/desktop/renderer/state/consoles.js";

const OVERSCAN_ROWS = 20;
const ROW_HEIGHT_PX = DEFAULT_APPEARANCE.density.rowHeightPx;
const PLACEHOLDER_TEXT = "…";
const STRIPE_EVERY = 2;

interface GridProps {
  readonly consoleId: string;
  readonly result: ResultTab;
}

function Rows({ consoleId, result }: GridProps) {
  const ensureWindow = useConsoles((state) => state.ensureWindow);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: result.rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: OVERSCAN_ROWS,
  });
  const items = virtualizer.getVirtualItems();
  const first = items[0]?.index;
  const last = items[items.length - 1]?.index;
  const { id: resultId, windows } = result;

  useEffect(() => {
    if (first === undefined || last === undefined) return;
    for (let offset = windowOffsetOf(first); offset <= last; offset += RESULT_WINDOW_ROWS)
      ensureWindow(consoleId, resultId, offset);
  }, [first, last, consoleId, resultId, ensureWindow]);

  const sample = windows[0];
  const template = useMemo(() => columnTemplate(columnChars(result.columns, sample ?? [])), [result.columns, sample]);
  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto font-grid text-grid">
      <div
        role="row"
        className="sticky top-0 z-10 grid h-row border-b border-line bg-panel"
        style={{ gridTemplateColumns: template }}
      >
        {result.columns.map((column, index) => (
          <div
            key={index}
            role="columnheader"
            className="truncate border-r border-line px-cell leading-(--spacing-row)"
          >
            {column.name}
          </div>
        ))}
      </div>
      <div role="rowgroup" className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {items.map((item) => {
          const row = rowAt(windows, item.index);
          return (
            <div
              key={item.key}
              role="row"
              className={`absolute left-0 grid h-row ${item.index % STRIPE_EVERY === 1 ? "bg-grid-stripe" : ""}`}
              style={{ gridTemplateColumns: template, transform: `translateY(${item.start}px)` }}
            >
              {result.columns.map((_column, index) => (
                <div
                  key={index}
                  role="gridcell"
                  className="truncate border-r border-line px-cell leading-(--spacing-row)"
                >
                  {row === undefined ? PLACEHOLDER_TEXT : formatCell(row[index] ?? null)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function summaryText(result: ResultTab): string {
  const rows = `${result.rowCount} ${result.rowCount === 1 ? "row" : "rows"}`;
  return result.truncated ? `${rows} (truncated)` : rows;
}

/** One result tab's rows, fetched from the engine a window at a time as they scroll into view. */
export function ResultGrid({ consoleId, result }: GridProps) {
  return (
    <div role="grid" aria-rowcount={result.rowCount} className="flex min-h-0 flex-1 flex-col">
      <Rows key={result.handle} consoleId={consoleId} result={result} />
      <div className="h-row border-t border-line bg-panel px-gap leading-(--spacing-row) text-ink-muted">
        {summaryText(result)}
      </div>
    </div>
  );
}
