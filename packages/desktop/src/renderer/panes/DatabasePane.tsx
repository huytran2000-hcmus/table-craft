import { datasourceName } from "@table-craft/desktop/renderer/model/format.js";
import { useConsoles } from "@table-craft/desktop/renderer/state/consoles.js";
import { cn } from "@table-craft/desktop/renderer/ui/cn.js";
import { DatabaseIcon } from "@table-craft/desktop/renderer/ui/icons.js";

const STATE_TEXT = { connecting: "connecting…", connected: "connected", failed: "failed" } as const;
const DOT_CLASS = { connecting: "bg-ink-muted", connected: "bg-success", failed: "bg-danger" } as const;

/** The current datasource as one node; plan 005 grows it into the explorer tree. */
export function DatabasePane() {
  const datasource = useConsoles((state) => state.datasource);
  const name = datasourceName(datasource);
  return (
    <ul role="tree" aria-label="Datasources" className="py-1">
      <li
        role="treeitem"
        aria-selected={false}
        aria-label={`${name}, ${STATE_TEXT[datasource.status]}`}
        title={datasource.error === null ? undefined : `${datasource.error.message} ${datasource.error.hint}`}
        tabIndex={0}
        data-state={datasource.status}
        className="flex h-row items-center gap-cell px-gap outline-none hover:bg-raised focus:bg-selection"
      >
        <DatabaseIcon
          aria-hidden
          className={cn("size-icon shrink-0", datasource.status === "failed" && "text-danger")}
        />
        <span className="truncate">{name}</span>
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT_CLASS[datasource.status])} />
        <span className={cn("truncate", datasource.status === "failed" ? "text-danger" : "text-ink-muted")}>
          {STATE_TEXT[datasource.status]}
        </span>
      </li>
    </ul>
  );
}
