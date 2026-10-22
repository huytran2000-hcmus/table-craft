import * as ContextMenu from "@radix-ui/react-context-menu";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { HISTORY_ACTION_IDS, type ServiceArgs } from "@table-craft/desktop/renderer/actions/historyActions.js";
import { invoke, registry } from "@table-craft/desktop/renderer/actions/index.js";
import {
  clockTime,
  connectionText,
  formatDuration,
  rowsText,
  SERVICE_STATE_TEXT,
  type ServiceState,
} from "@table-craft/desktop/renderer/model/format.js";
import {
  expandable,
  movedInTree,
  serviceRows,
  servicesTree,
  type ServiceRow,
} from "@table-craft/desktop/renderer/model/servicesTree.js";
import { useConsoles } from "@table-craft/desktop/renderer/state/consoles.js";
import { connectionOf, useDatasources } from "@table-craft/desktop/renderer/state/datasources.js";
import { useExecutions, type Execution } from "@table-craft/desktop/renderer/state/executions.js";
import { useTables } from "@table-craft/desktop/renderer/state/tables.js";
import { useTabs } from "@table-craft/desktop/renderer/state/tabs.js";
import { cn } from "@table-craft/desktop/renderer/ui/cn.js";
import {
  CollapsedIcon,
  ConsoleIcon,
  DatabaseIcon,
  ExpandedIcon,
  SpinnerIcon,
  TableIcon,
} from "@table-craft/desktop/renderer/ui/icons.js";
import { OutcomeGlyph } from "@table-craft/desktop/renderer/ui/Outcome.js";

const STATE_CLASS: Readonly<Record<ServiceState, string>> = {
  connecting: "text-ink-muted",
  idle: "text-ink-muted",
  running: "text-accent",
  waiting: "text-warning",
  failed: "text-danger",
  disconnected: "text-ink-muted",
};
const INDENT_PX = 16;
/** A running execution's elapsed time ticks this often (plan 011 decision 12). */
const TICK_MS = 1000;
const NO_COLLAPSED: ReadonlySet<string> = new Set();

/** `Date.now()`, re-read every second while `ticking`. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, TICK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [ticking]);
  return now;
}

interface MenuEntry {
  readonly actionId: string;
  readonly args: ServiceArgs;
}

function menuOf(row: ServiceRow, cancellable: boolean): readonly MenuEntry[] {
  if (row.kind === "session") {
    const args = { tabId: row.node.tabId };
    return [
      ...(cancellable ? [{ actionId: HISTORY_ACTION_IDS.cancel, args }] : []),
      { actionId: HISTORY_ACTION_IDS.clearExecutions, args },
    ];
  }
  if (row.kind === "execution" && row.node.sql !== null) {
    const args = { tabId: row.tabId, executionId: row.node.id };
    return [
      { actionId: HISTORY_ACTION_IDS.copySql, args },
      { actionId: HISTORY_ACTION_IDS.openInConsole, args },
    ];
  }
  return [];
}

function Menu({ entries }: { readonly entries: readonly MenuEntry[] }) {
  return (
    <ContextMenu.Portal>
      <ContextMenu.Content className="z-50 min-w-56 rounded border border-line bg-raised p-1 text-ui text-ink shadow-lg">
        {entries.map((entry) => (
          <ContextMenu.Item
            key={entry.actionId}
            className="flex h-row cursor-default items-center rounded px-gap outline-none data-[highlighted]:bg-selection"
            onSelect={() => invoke(entry.actionId, entry.args)}
          >
            {registry.get(entry.actionId)?.title ?? entry.actionId}
          </ContextMenu.Item>
        ))}
      </ContextMenu.Content>
    </ContextMenu.Portal>
  );
}

function DatasourceLine({ row }: { readonly row: Extract<ServiceRow, { kind: "datasource" }> }) {
  const connection = useDatasources((state) => connectionOf(state, row.node.datasourceId));
  return (
    <>
      <DatabaseIcon
        aria-hidden
        className={cn("size-icon shrink-0", connection.status === "failed" ? "text-danger" : "text-accent")}
      />
      <span className="truncate">{row.node.name}</span>
      <span className={cn("truncate", connection.status === "failed" ? "text-danger" : "text-ink-muted")}>
        {connectionText(connection)}
      </span>
    </>
  );
}

function SessionLine({ row }: { readonly row: Extract<ServiceRow, { kind: "session" }> }) {
  const { node } = row;
  const Glyph = node.state === "running" ? SpinnerIcon : node.kind === "console" ? ConsoleIcon : TableIcon;
  return (
    <>
      <Glyph
        aria-hidden
        className={cn("size-icon shrink-0", node.state === "running" ? "animate-spin text-accent" : "text-ink-muted")}
      />
      <span className="truncate">{node.title}</span>
      <span className={STATE_CLASS[node.state]}>{SERVICE_STATE_TEXT[node.state]}</span>
      {node.lastDurationMs === null ? null : (
        <span className="ml-auto shrink-0 text-ink-muted tabular-nums">{formatDuration(node.lastDurationMs)}</span>
      )}
    </>
  );
}

function ExecutionLine({ execution, now }: { readonly execution: Execution; readonly now: number }) {
  const duration = execution.durationMs ?? Math.max(0, now - execution.startedAt);
  return (
    <>
      <OutcomeGlyph outcome={execution.outcome} />
      <span className="min-w-0 truncate font-editor text-editor" title={execution.message ?? undefined}>
        {execution.label}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-cell text-ink-muted tabular-nums">
        {execution.rowCount === null ? null : <span>{rowsText(execution.rowCount)}</span>}
        <span data-testid="execution-duration">{formatDuration(duration)}</span>
        <span>{clockTime(execution.startedAt)}</span>
      </span>
    </>
  );
}

function rowLabel(row: ServiceRow): string {
  if (row.kind === "datasource") return row.node.name;
  if (row.kind === "session") return `${row.node.title}, ${SERVICE_STATE_TEXT[row.node.state]}`;
  return `${row.node.label}, ${row.node.outcome}`;
}

/**
 * The Services tree (plan 011 decision 12): each datasource with an open console or table tab, its
 * sessions, and what each sent, newest first. Enter or a click on a session or execution shows its tab.
 */
export function ServicesPane() {
  const tabs = useTabs((state) => state.tabs);
  const activeId = useTabs((state) => state.activeId);
  const activate = useTabs((state) => state.activate);
  const consoles = useConsoles((state) => state.consoles);
  const tables = useTables((state) => state.tables);
  const executions = useExecutions((state) => state.byTab);
  const datasources = useDatasources((state) => state.datasources);
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(NO_COLLAPSED);
  const elements = useRef(new Map<string, HTMLLIElement>());

  const tree = useMemo(
    () => servicesTree({ tabs, consoles, tables, executions, datasources }),
    [tabs, consoles, tables, executions, datasources],
  );
  const rows = useMemo(() => serviceRows(tree, collapsed), [tree, collapsed]);
  const running = rows.some((row) => row.kind === "execution" && row.node.outcome === "running");
  const now = useNow(running);
  const selectedIndex = rows.findIndex((row) => row.key === selected);

  function select(key: string | null): void {
    setSelected(key);
    if (key !== null) elements.current.get(key)?.focus();
  }

  function open(row: ServiceRow): void {
    if (row.kind === "session") activate(row.node.tabId);
    else if (row.kind === "execution") activate(row.tabId);
  }

  function toggle(row: ServiceRow): void {
    const next = new Set(collapsed);
    if (next.has(row.key)) next.delete(row.key);
    else next.add(row.key);
    setCollapsed(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>): void {
    const current = rows[selectedIndex];
    if (event.key === "Enter" && current !== undefined) {
      open(current);
      event.preventDefault();
      return;
    }
    const moved = movedInTree(rows, selected, collapsed, event.key);
    if (moved === null) return;
    event.preventDefault();
    setCollapsed(moved.collapsed);
    select(moved.selected);
  }

  if (rows.length === 0) return <p className="p-gap text-ink-muted">No open sessions.</p>;
  return (
    <ul
      role="tree"
      aria-label="Services"
      tabIndex={selectedIndex === -1 ? 0 : -1}
      className="py-1 outline-none"
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        if (event.target === event.currentTarget && selectedIndex === -1 && rows[0] !== undefined) select(rows[0].key);
      }}
    >
      {rows.map((row, index) => {
        const isSelected = index === selectedIndex;
        const active = row.kind === "session" && row.node.tabId === activeId;
        const canExpand = expandable(row);
        const cancellable =
          row.kind === "session" && row.node.kind === "console" && consoles[row.node.tabId]?.status === "running";
        const entries = menuOf(row, cancellable);
        const line = (
          <li
            key={row.key}
            ref={(element) => {
              if (element === null) elements.current.delete(row.key);
              else elements.current.set(row.key, element);
            }}
            role="treeitem"
            aria-level={row.depth + 1}
            aria-selected={isSelected}
            aria-expanded={canExpand ? !collapsed.has(row.key) : undefined}
            aria-label={rowLabel(row)}
            tabIndex={isSelected ? 0 : -1}
            data-kind={row.kind}
            data-state={
              row.kind === "session" ? row.node.state : row.kind === "execution" ? row.node.outcome : undefined
            }
            style={{ paddingLeft: `calc(var(--spacing-gap) + ${String(row.depth * INDENT_PX)}px)` }}
            className={cn(
              "flex h-row cursor-default items-center gap-cell pr-gap outline-none hover:bg-raised",
              isSelected && "bg-selection hover:bg-selection",
              !isSelected && active && "bg-raised",
            )}
            onMouseDown={() => select(row.key)}
            onContextMenu={() => select(row.key)}
            onClick={() => open(row)}
          >
            {canExpand ? (
              <button
                type="button"
                tabIndex={-1}
                aria-hidden
                className="flex size-icon shrink-0 items-center justify-center text-ink-muted"
                onClick={(event) => {
                  event.stopPropagation();
                  toggle(row);
                }}
              >
                {collapsed.has(row.key) ? <CollapsedIcon /> : <ExpandedIcon />}
              </button>
            ) : (
              <span aria-hidden className="size-icon shrink-0" />
            )}
            {row.kind === "datasource" ? (
              <DatasourceLine row={row} />
            ) : row.kind === "session" ? (
              <SessionLine row={row} />
            ) : (
              <ExecutionLine execution={row.node} now={now} />
            )}
          </li>
        );
        if (entries.length === 0) return line;
        return (
          <ContextMenu.Root key={row.key}>
            <ContextMenu.Trigger asChild>{line}</ContextMenu.Trigger>
            <Menu entries={entries} />
          </ContextMenu.Root>
        );
      })}
    </ul>
  );
}
