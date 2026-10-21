import * as ContextMenu from "@radix-ui/react-context-menu";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ACTION_IDS } from "@table-craft/desktop/renderer/actions/appActions.js";
import { currentPlatform, formatChord } from "@table-craft/desktop/renderer/actions/chords.js";
import { invoke, registry, useActionEnabled } from "@table-craft/desktop/renderer/actions/index.js";
import { connectionText } from "@table-craft/desktop/renderer/model/format.js";
import {
  buildTree,
  visibleRows,
  type TreeNode,
  type VisibleRow,
} from "@table-craft/desktop/renderer/model/datasourceTree.js";
import {
  connectionOf,
  pluginOf,
  useDatasources,
  type TreeSelection,
} from "@table-craft/desktop/renderer/state/datasources.js";
import { cn } from "@table-craft/desktop/renderer/ui/cn.js";
import {
  ACTION_ICONS,
  CollapsedIcon,
  DatabaseIcon,
  ExpandedIcon,
  FolderIcon,
  ReadOnlyIcon,
  WarningIcon,
} from "@table-craft/desktop/renderer/ui/icons.js";
import { TINT_SWATCH } from "@table-craft/desktop/renderer/ui/tint.js";
import { Tooltip } from "@table-craft/desktop/renderer/ui/Tooltip.js";

const TOOLBAR_ACTIONS = [
  ACTION_IDS.newDatasource,
  ACTION_IDS.datasourceProperties,
  ACTION_IDS.connect,
  ACTION_IDS.disconnect,
  ACTION_IDS.newConsole,
] as const;
const DATASOURCE_MENU = [
  ACTION_IDS.newConsole,
  ACTION_IDS.connect,
  ACTION_IDS.disconnect,
  null,
  ACTION_IDS.datasourceProperties,
  ACTION_IDS.duplicateDatasource,
  ACTION_IDS.moveToFolder,
  null,
  ACTION_IDS.deleteDatasource,
] as const;
const FOLDER_MENU = [ACTION_IDS.newDatasource, ACTION_IDS.newFolder] as const;
const DOT_CLASS = {
  disconnected: null,
  connecting: "bg-ink-muted animate-pulse",
  connected: "bg-success",
  failed: "bg-danger",
} as const;
const INDENT_PX = 16;

function shortcutOf(actionId: string): string | undefined {
  const shortcut = registry.get(actionId)?.shortcut;
  return shortcut === undefined ? undefined : formatChord(shortcut, currentPlatform());
}

function ToolbarButton({ actionId }: { readonly actionId: string }) {
  const enabled = useActionEnabled(actionId);
  const action = registry.get(actionId);
  if (action === undefined) return null;
  const Icon = action.icon === undefined ? DatabaseIcon : ACTION_ICONS[action.icon];
  return (
    <Tooltip label={action.title} shortcut={shortcutOf(actionId)} side="bottom">
      <button
        type="button"
        aria-label={action.title}
        disabled={!enabled}
        className="flex size-tab items-center justify-center rounded text-ink-muted hover:bg-raised hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
        onClick={() => invoke(actionId)}
      >
        <Icon aria-hidden className="size-icon" />
      </button>
    </Tooltip>
  );
}

function MenuItem({ actionId }: { readonly actionId: string }) {
  const enabled = useActionEnabled(actionId);
  const action = registry.get(actionId);
  if (action === undefined) return null;
  const shortcut = shortcutOf(actionId);
  return (
    <ContextMenu.Item
      disabled={!enabled}
      className="flex h-row cursor-default items-center justify-between gap-gap rounded px-gap outline-none data-[disabled]:text-ink-muted data-[highlighted]:bg-selection"
      onSelect={() => invoke(actionId)}
    >
      <span>{action.title}</span>
      {shortcut === undefined ? null : <span className="text-ink-muted">{shortcut}</span>}
    </ContextMenu.Item>
  );
}

function Menu({ items }: { readonly items: readonly (string | null)[] }) {
  return (
    <ContextMenu.Portal>
      <ContextMenu.Content className="z-50 min-w-56 rounded border border-line bg-raised p-1 text-ui text-ink shadow-lg">
        {items.map((actionId, index) =>
          actionId === null ? (
            <ContextMenu.Separator key={`separator-${String(index)}`} className="my-1 h-px bg-line" />
          ) : (
            <MenuItem key={actionId} actionId={actionId} />
          ),
        )}
      </ContextMenu.Content>
    </ContextMenu.Portal>
  );
}

function selectionOf(node: TreeNode): TreeSelection {
  return node.kind === "folder" ? { kind: "folder", path: node.path } : { kind: "datasource", id: node.datasource.id };
}

function isSelected(selection: TreeSelection | null, node: TreeNode): boolean {
  if (selection === null) return false;
  if (node.kind === "folder") return selection.kind === "folder" && selection.path === node.path;
  return selection.kind === "datasource" && selection.id === node.datasource.id;
}

function DatasourceLabel({ node }: { readonly node: Extract<TreeNode, { kind: "datasource" }> }) {
  const { datasource } = node;
  const connection = useDatasources((state) => connectionOf(state, datasource.id));
  const plugin = useDatasources((state) => pluginOf(state.plugins, datasource.pluginId));
  const dot = DOT_CLASS[connection.status];
  const failed = connection.status === "failed";
  return (
    <>
      <DatabaseIcon aria-hidden className={cn("size-icon shrink-0", failed ? "text-danger" : "text-accent")} />
      <span className="truncate">{datasource.name}</span>
      {datasource.color === null ? null : (
        <span aria-hidden data-swatch className={cn("size-2.5 shrink-0 rounded-sm", TINT_SWATCH[datasource.color])} />
      )}
      {datasource.readOnly ? (
        <ReadOnlyIcon aria-label="read-only" className="size-icon shrink-0 text-ink-muted" />
      ) : null}
      {dot === null ? null : <span aria-hidden className={cn("size-2 shrink-0 rounded-full", dot)} />}
      {connection.status === "disconnected" ? null : (
        <span className={cn("truncate", failed ? "text-danger" : "text-ink-muted")}>{connectionText(connection)}</span>
      )}
      {plugin === undefined || connection.status !== "disconnected" ? null : (
        <span className="truncate text-ink-muted">{plugin.name}</span>
      )}
    </>
  );
}

interface RowProps {
  readonly row: VisibleRow;
  readonly selected: boolean;
  readonly expanded: boolean;
  readonly onSelect: (row: VisibleRow) => void;
  readonly onToggle: (path: string) => void;
  readonly register: (key: string, element: HTMLLIElement | null) => void;
}

function TreeRow({ row, selected, expanded, onSelect, onToggle, register }: RowProps) {
  const { node, depth } = row;
  const connection = useDatasources((state) =>
    node.kind === "datasource" ? connectionOf(state, node.datasource.id) : null,
  );
  const label =
    node.kind === "folder"
      ? `${node.name}, folder`
      : `${node.datasource.name}, ${connectionText(connection ?? { status: "disconnected", error: null, serverVersion: null })}`;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <li
          ref={(element) => register(row.key, element)}
          role="treeitem"
          aria-label={label}
          aria-level={depth + 1}
          aria-selected={selected}
          aria-expanded={node.kind === "folder" ? expanded : undefined}
          title={connection?.error == null ? undefined : `${connection.error.message} ${connection.error.hint}`}
          tabIndex={selected ? 0 : -1}
          data-state={connection?.status}
          data-kind={node.kind}
          style={{ paddingLeft: `calc(var(--spacing-gap) + ${String(depth * INDENT_PX)}px)` }}
          className={cn(
            "flex h-row cursor-default items-center gap-cell pr-gap outline-none hover:bg-raised",
            selected && "bg-selection hover:bg-selection",
          )}
          onMouseDown={() => onSelect(row)}
          onContextMenu={() => onSelect(row)}
          onDoubleClick={() => {
            if (node.kind === "folder") onToggle(node.path);
            else invoke(ACTION_IDS.newConsole);
          }}
        >
          {node.kind === "folder" ? (
            <>
              <button
                type="button"
                tabIndex={-1}
                aria-hidden
                className="flex size-icon shrink-0 items-center justify-center text-ink-muted"
                onClick={() => onToggle(node.path)}
              >
                {expanded ? <ExpandedIcon /> : <CollapsedIcon />}
              </button>
              <FolderIcon aria-hidden className="size-icon shrink-0 text-ink-muted" />
              <span className="truncate">{node.name}</span>
            </>
          ) : (
            <>
              <span aria-hidden className="size-icon shrink-0" />
              <DatasourceLabel node={node} />
            </>
          )}
        </li>
      </ContextMenu.Trigger>
      <Menu items={node.kind === "folder" ? FOLDER_MENU : DATASOURCE_MENU} />
    </ContextMenu.Root>
  );
}

function EmptyState() {
  const shortcut = shortcutOf(ACTION_IDS.newDatasource);
  return (
    <div className="flex flex-col items-start gap-gap p-gap text-ink-muted">
      <p>No data sources.</p>
      <button
        type="button"
        className="rounded border border-line px-gap py-1 text-ink hover:bg-raised"
        onClick={() => invoke(ACTION_IDS.newDatasource)}
      >
        New Data Source{shortcut === undefined ? "" : ` (${shortcut})`}
      </button>
    </div>
  );
}

function LoadWarning() {
  const warning = useDatasources((state) => state.warning);
  const dismiss = useDatasources((state) => state.dismissWarning);
  if (warning === null) return null;
  return (
    <div role="alert" className="mx-gap mb-gap flex items-start gap-cell rounded border border-danger p-cell text-ink">
      <WarningIcon aria-hidden className="mt-0.5 size-icon shrink-0 text-danger" />
      <span className="min-w-0 flex-1">{warning}</span>
      <button type="button" className="text-ink-muted hover:text-ink" onClick={dismiss}>
        Dismiss
      </button>
    </div>
  );
}

/** Datasources in their folders, with their connection state (plan 004); plan 005 adds schemas. */
export function DatabasePane() {
  const datasources = useDatasources((state) => state.datasources);
  const emptyFolders = useDatasources((state) => state.emptyFolders);
  const loaded = useDatasources((state) => state.loaded);
  const selection = useDatasources((state) => state.selection);
  const select = useDatasources((state) => state.select);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const elements = useRef(new Map<string, HTMLLIElement>());
  const tree = useMemo(() => buildTree(datasources, emptyFolders), [datasources, emptyFolders]);
  const rows = useMemo(() => visibleRows(tree, collapsed), [tree, collapsed]);

  function toggle(path: string): void {
    const next = new Set(collapsed);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setCollapsed(next);
  }

  function selectRow(row: VisibleRow): void {
    select(selectionOf(row.node));
    elements.current.get(row.key)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>): void {
    const index = rows.findIndex((row) => isSelected(selection, row.node));
    const current = rows[index];
    const move = (to: number) => {
      const target = rows[Math.max(0, Math.min(rows.length - 1, to))];
      if (target !== undefined) selectRow(target);
    };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index === -1 ? 0 : index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(rows.length - 1);
    else if (event.key === "ArrowRight" && current?.node.kind === "folder" && collapsed.has(current.node.path)) {
      toggle(current.node.path);
    } else if (event.key === "ArrowLeft" && current?.node.kind === "folder" && !collapsed.has(current.node.path)) {
      toggle(current.node.path);
    } else if (event.key === "Enter" && current !== undefined) {
      if (current.node.kind === "folder") toggle(current.node.path);
      else invoke(ACTION_IDS.newConsole);
    } else return;
    event.preventDefault();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="toolbar" aria-label="Database toolbar" className="flex shrink-0 items-center gap-1 px-1">
        {TOOLBAR_ACTIONS.map((actionId) => (
          <ToolbarButton key={actionId} actionId={actionId} />
        ))}
      </div>
      <LoadWarning />
      {loaded && rows.length === 0 ? (
        <EmptyState />
      ) : (
        <ul
          role="tree"
          aria-label="Datasources"
          tabIndex={selection === null ? 0 : -1}
          className="min-h-0 flex-1 overflow-y-auto py-1 outline-none"
          onKeyDown={onKeyDown}
          onFocus={(event) => {
            if (event.target === event.currentTarget && selection === null && rows[0] !== undefined) {
              selectRow(rows[0]);
            }
          }}
        >
          {rows.map((row) => (
            <TreeRow
              key={row.key}
              row={row}
              selected={isSelected(selection, row.node)}
              expanded={row.node.kind === "folder" && !collapsed.has(row.node.path)}
              onSelect={selectRow}
              onToggle={toggle}
              register={(key, element) => {
                if (element === null) elements.current.delete(key);
                else elements.current.set(key, element);
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
