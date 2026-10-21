import { ACTION_IDS } from "@table-craft/desktop/renderer/actions/appActions.js";
import { ActionButton } from "@table-craft/desktop/renderer/console/ActionButton.js";
import { Editor } from "@table-craft/desktop/renderer/console/Editor.js";
import { ResultTabs } from "@table-craft/desktop/renderer/console/ResultTabs.js";
import { TxControls } from "@table-craft/desktop/renderer/console/TxControls.js";
import { useConsoleDatasource } from "@table-craft/desktop/renderer/console/useConsoleDatasource.js";
import { useConsoles } from "@table-craft/desktop/renderer/state/consoles.js";
import { pluginOf, useDatasources } from "@table-craft/desktop/renderer/state/datasources.js";
import { cn } from "@table-craft/desktop/renderer/ui/cn.js";
import { ReadOnlyIcon } from "@table-craft/desktop/renderer/ui/icons.js";
import { TINT_BORDER } from "@table-craft/desktop/renderer/ui/tint.js";

const STATUS_TEXT = {
  connecting: "Connecting…",
  running: "Running…",
  ready: "",
  failed: "",
  disconnected: "Disconnected; Run reconnects.",
} as const;

/** One console tab: its toolbar, its SQL editor, and its Output and result tabs. */
export function Console({ consoleId }: { readonly consoleId: string }) {
  const session = useConsoles((state) => state.consoles[consoleId]);
  const datasource = useConsoleDatasource(consoleId);
  const plugin = useDatasources((state) => pluginOf(state.plugins, datasource?.pluginId ?? ""));
  if (session === undefined) return null;
  const { status, error } = session;
  const capabilities = plugin?.capabilities ?? [];
  const color = datasource?.color ?? null;

  return (
    <div data-testid="console" data-color={color ?? undefined} className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-gap border-b border-line bg-panel p-gap">
        <ActionButton actionId={ACTION_IDS.run} primary />
        <ActionButton actionId={ACTION_IDS.runAll} />
        {capabilities.includes("cancel") ? <ActionButton actionId={ACTION_IDS.cancel} /> : null}
        {capabilities.includes("transactions") ? <TxControls session={session} /> : null}
        <span className="shrink-0 text-ink-muted">{STATUS_TEXT[status]}</span>
        {error === null ? null : (
          <span role="alert" className="min-w-0 truncate text-danger" title={`${error.message} ${error.hint}`}>
            {error.message} <span className="text-ink-muted">{error.hint}</span>
          </span>
        )}
        {datasource === undefined ? null : (
          <span className="ml-auto flex shrink-0 items-center gap-1 text-ink-muted">
            {datasource.readOnly ? <ReadOnlyIcon aria-hidden className="size-icon" /> : null}
            {datasource.readOnly ? "read-only · " : ""}
            {datasource.name}
            {plugin === undefined ? "" : ` · ${plugin.name}`}
          </span>
        )}
      </div>
      <div
        className={cn(
          "min-h-0 flex-1 basis-1/2 overflow-hidden border-b border-line",
          color !== null && `border-2 ${TINT_BORDER[color]}`,
        )}
      >
        <Editor consoleId={consoleId} />
      </div>
      <ResultTabs consoleId={consoleId} session={session} />
    </div>
  );
}
