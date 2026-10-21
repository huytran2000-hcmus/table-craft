import * as ContextMenu from "@radix-ui/react-context-menu";
import { ACTION_IDS, type TabArgs } from "@table-craft/desktop/renderer/actions/appActions.js";
import { currentPlatform, formatChord } from "@table-craft/desktop/renderer/actions/chords.js";
import { REGION_ATTRIBUTE } from "@table-craft/desktop/renderer/actions/context.js";
import { invoke, registry, useActionEnabled } from "@table-craft/desktop/renderer/actions/index.js";
import { Console } from "@table-craft/desktop/renderer/console/Console.js";
import { activeTab, useTabs, type Tab } from "@table-craft/desktop/renderer/state/tabs.js";
import { cn } from "@table-craft/desktop/renderer/ui/cn.js";
import { CloseIcon, ConsoleIcon } from "@table-craft/desktop/renderer/ui/icons.js";

const TAB_MENU_ACTIONS = [ACTION_IDS.closeTab, ACTION_IDS.closeOtherTabs, ACTION_IDS.closeAllTabs] as const;

function TabMenuItem({ actionId, tabId }: { readonly actionId: string; readonly tabId: string }) {
  const enabled = useActionEnabled(actionId);
  const action = registry.get(actionId);
  if (action === undefined) return null;
  const args: TabArgs = { tabId };
  return (
    <ContextMenu.Item
      disabled={!enabled}
      className="flex h-row cursor-default items-center justify-between gap-gap rounded px-gap outline-none data-[disabled]:text-ink-muted data-[highlighted]:bg-selection"
      onSelect={() => invoke(actionId, args)}
    >
      <span>{action.title}</span>
      {action.shortcut === undefined ? null : (
        <span className="text-ink-muted">{formatChord(action.shortcut, currentPlatform())}</span>
      )}
    </ContextMenu.Item>
  );
}

function TabButton({ tab, active }: { readonly tab: Tab; readonly active: boolean }) {
  const activate = useTabs((state) => state.activate);
  const args: TabArgs = { tabId: tab.id };
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          className={cn(
            "group flex h-tab shrink-0 items-center gap-cell border-r border-b-2 border-r-line px-gap",
            active ? "border-b-accent bg-canvas text-ink" : "border-b-transparent text-ink-muted hover:bg-raised",
          )}
        >
          <button
            type="button"
            role="tab"
            aria-selected={active}
            className="flex items-center gap-cell outline-none"
            onClick={() => activate(tab.id)}
          >
            <ConsoleIcon aria-hidden className="size-icon" />
            {tab.title}
          </button>
          <button
            type="button"
            aria-label={`Close ${tab.title}`}
            tabIndex={-1}
            className={cn(
              "flex size-icon items-center justify-center rounded hover:bg-raised hover:text-ink",
              !active && "invisible group-hover:visible",
            )}
            onClick={() => invoke(ACTION_IDS.closeTab, args)}
          >
            <CloseIcon aria-hidden />
          </button>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-48 rounded border border-line bg-raised p-1 text-ui text-ink shadow-lg">
          {TAB_MENU_ACTIONS.map((actionId) => (
            <TabMenuItem key={actionId} actionId={actionId} tabId={tab.id} />
          ))}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function EmptyEditor() {
  const action = registry.get(ACTION_IDS.newConsole);
  const shortcut = action?.shortcut === undefined ? "" : formatChord(action.shortcut, currentPlatform());
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-gap text-ink-muted">
      <p>No open consoles.</p>
      <p>
        Press <kbd className="rounded border border-line px-1 font-ui text-ink">{shortcut}</kbd> to open a new console.
      </p>
    </div>
  );
}

/** The tab strip and the active tab's content. */
export function EditorArea() {
  const tabs = useTabs((state) => state.tabs);
  const active = useTabs(activeTab);
  return (
    <section
      aria-label="Editor"
      {...{ [REGION_ATTRIBUTE]: "editor" }}
      className="flex h-full min-h-0 flex-col bg-canvas"
    >
      {tabs.length === 0 ? null : (
        <div role="tablist" aria-label="Editor tabs" className="flex shrink-0 overflow-x-auto bg-panel">
          {tabs.map((tab) => (
            <TabButton key={tab.id} tab={tab} active={tab.id === active?.id} />
          ))}
        </div>
      )}
      {active === null ? <EmptyEditor /> : <Console key={active.id} consoleId={active.id} />}
    </section>
  );
}
