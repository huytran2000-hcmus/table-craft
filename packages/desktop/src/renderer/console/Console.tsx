import { ACTION_IDS } from "@table-craft/desktop/renderer/actions/appActions.js";
import { currentPlatform, formatChord } from "@table-craft/desktop/renderer/actions/chords.js";
import { invoke, registry, useActionEnabled } from "@table-craft/desktop/renderer/actions/index.js";
import { ResultGrid } from "@table-craft/desktop/renderer/grid/ResultGrid.js";
import { AUTOFOCUS_ATTRIBUTE } from "@table-craft/desktop/renderer/shell/focus.js";
import { useConsoles } from "@table-craft/desktop/renderer/state/consoles.js";
import { ACTION_ICONS } from "@table-craft/desktop/renderer/ui/icons.js";
import { Tooltip } from "@table-craft/desktop/renderer/ui/Tooltip.js";

const STATUS_TEXT = { connecting: "Connecting…", running: "Running…", ready: "", failed: "" } as const;

/** A toolbar button that is an action: its label, icon, tooltip and enabled state come from the registry. */
function ActionButton({ actionId, primary = false }: { readonly actionId: string; readonly primary?: boolean }) {
  const enabled = useActionEnabled(actionId);
  const action = registry.get(actionId);
  if (action === undefined) return null;
  const Icon = action.icon === undefined ? null : ACTION_ICONS[action.icon];
  const shortcut = action.shortcut === undefined ? undefined : formatChord(action.shortcut, currentPlatform());
  return (
    <Tooltip label={action.title} shortcut={shortcut} side="bottom">
      <button
        type="button"
        className={
          primary
            ? "flex h-row items-center gap-1 rounded bg-accent px-gap text-accent-ink disabled:opacity-50"
            : "flex h-row items-center gap-1 rounded border border-line px-gap text-ink disabled:opacity-50"
        }
        disabled={!enabled}
        onClick={() => invoke(actionId)}
      >
        {Icon === null ? null : <Icon aria-hidden weight="fill" className="size-icon" />}
        {action.title}
      </button>
    </Tooltip>
  );
}

/** One console tab: a plain textarea until CodeMirror lands (plan 006), its toolbar, and its result. */
export function Console({ consoleId }: { readonly consoleId: string }) {
  const session = useConsoles((state) => state.consoles[consoleId]);
  const canCancel = useConsoles((state) => state.datasource.capabilities.includes("cancel"));
  const pluginName = useConsoles((state) => state.datasource.pluginName);
  const setSql = useConsoles((state) => state.setSql);
  if (session === undefined) return null;
  const { status, error, sql } = session;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section className="flex flex-col gap-gap border-b border-line bg-panel p-gap">
        <div className="flex items-center gap-gap">
          <ActionButton actionId={ACTION_IDS.run} primary />
          {canCancel ? <ActionButton actionId={ACTION_IDS.cancel} /> : null}
          <span className="text-ink-muted">{STATUS_TEXT[status]}</span>
          {error === null ? null : (
            <span role="alert" className="min-w-0 truncate text-danger" title={`${error.message} ${error.hint}`}>
              {error.message} <span className="text-ink-muted">{error.hint}</span>
            </span>
          )}
          {pluginName === null ? null : <span className="ml-auto shrink-0 text-ink-muted">{pluginName}</span>}
        </div>
        <textarea
          aria-label="SQL console"
          {...{ [AUTOFOCUS_ATTRIBUTE]: "" }}
          // Each tab mounts its own console, so focus follows the tab the user just chose.
          autoFocus
          className="h-console resize-y rounded border border-line bg-canvas p-cell font-editor text-editor text-ink outline-none focus:border-accent"
          spellCheck={false}
          value={sql}
          onChange={(event) => setSql(consoleId, event.target.value)}
        />
      </section>
      <ResultGrid consoleId={consoleId} />
    </div>
  );
}
