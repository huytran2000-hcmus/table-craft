import type { ComponentType } from "react";
import { datasourceText } from "@table-craft/desktop/renderer/model/format.js";
import { useConsoles } from "@table-craft/desktop/renderer/state/consoles.js";
import { cn } from "@table-craft/desktop/renderer/ui/cn.js";
import { SpinnerIcon } from "@table-craft/desktop/renderer/ui/icons.js";

/** One slot in the status bar; later plans add caret position (006) and sync time (005). */
export interface StatusItem {
  readonly id: string;
  readonly side: "left" | "right";
  readonly Component: ComponentType;
}

const DOT_CLASS = { connecting: "bg-ink-muted", connected: "bg-success", failed: "bg-danger" } as const;

function DatasourceStatus() {
  const datasource = useConsoles((state) => state.datasource);
  return (
    <span
      data-testid="status-datasource"
      title={datasource.error?.hint}
      className={cn("flex min-w-0 items-center gap-cell", datasource.status === "failed" && "text-danger")}
    >
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT_CLASS[datasource.status])} />
      <span className="truncate">{datasourceText(datasource)}</span>
    </span>
  );
}

function RunningIndicator() {
  const running = useConsoles(
    (state) => Object.values(state.consoles).filter((session) => session.status === "running").length,
  );
  if (running === 0) return null;
  return (
    <span data-testid="status-running" className="flex items-center gap-cell">
      <SpinnerIcon aria-hidden className="size-icon animate-spin text-accent" />
      {running === 1 ? "Running 1 statement" : `Running ${running} statements`}
    </span>
  );
}

export const STATUS_ITEMS: readonly StatusItem[] = [
  { id: "datasource", side: "left", Component: DatasourceStatus },
  { id: "running", side: "right", Component: RunningIndicator },
];
