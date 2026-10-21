import {
  formatDuration,
  serviceState,
  tabLabel,
  type ServiceState,
} from "@table-craft/desktop/renderer/model/format.js";
import { useConsoles } from "@table-craft/desktop/renderer/state/consoles.js";
import { datasourceById, useDatasources } from "@table-craft/desktop/renderer/state/datasources.js";
import { useTabs } from "@table-craft/desktop/renderer/state/tabs.js";
import { cn } from "@table-craft/desktop/renderer/ui/cn.js";
import { ConsoleIcon, SpinnerIcon } from "@table-craft/desktop/renderer/ui/icons.js";

const STATE_CLASS: Readonly<Record<ServiceState, string>> = {
  connecting: "text-ink-muted",
  idle: "text-ink-muted",
  running: "text-accent",
  failed: "text-danger",
  disconnected: "text-ink-muted",
};

/** Open consoles with their state and last run; plan 011 grows it into the Services tree. */
export function ServicesPane() {
  const tabs = useTabs((state) => state.tabs);
  const activeId = useTabs((state) => state.activeId);
  const activate = useTabs((state) => state.activate);
  const consoles = useConsoles((state) => state.consoles);
  const datasources = useDatasources((state) => state);
  const listed = tabs.flatMap((tab) => {
    const session = consoles[tab.id];
    return tab.kind === "console" && session !== undefined ? [{ tab, session }] : [];
  });

  if (listed.length === 0) return <p className="p-gap text-ink-muted">No open consoles.</p>;
  return (
    <ul role="listbox" aria-label="Consoles" className="py-1">
      {listed.map(({ tab, session }) => {
        const state = serviceState(session);
        const label = tabLabel(tab.title, datasourceById(datasources, session.datasourceId)?.name);
        return (
          <li
            key={tab.id}
            role="option"
            aria-label={label}
            aria-selected={tab.id === activeId}
            data-state={state}
            className={cn(
              "flex h-row cursor-default items-center gap-cell px-gap hover:bg-raised",
              tab.id === activeId && "bg-selection",
            )}
            onClick={() => activate(tab.id)}
          >
            {state === "running" ? (
              <SpinnerIcon aria-hidden className="size-icon shrink-0 animate-spin text-accent" />
            ) : (
              <ConsoleIcon aria-hidden className="size-icon shrink-0 text-ink-muted" />
            )}
            <span className="truncate">{label}</span>
            <span className={STATE_CLASS[state]}>{state}</span>
            {session.lastRun === null ? null : (
              <span className="ml-auto text-ink-muted tabular-nums">{formatDuration(session.lastRun.durationMs)}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
