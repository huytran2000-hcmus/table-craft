import { currentPlatform, formatChord } from "@table-craft/desktop/renderer/actions/chords.js";
import { invoke, registry, useActionEnabled } from "@table-craft/desktop/renderer/actions/index.js";
import { ACTION_ICONS } from "@table-craft/desktop/renderer/ui/icons.js";
import { Tooltip } from "@table-craft/desktop/renderer/ui/Tooltip.js";

/** A toolbar button that is an action: its label, icon, tooltip and enabled state come from the registry. */
export function ActionButton({ actionId, primary = false }: { readonly actionId: string; readonly primary?: boolean }) {
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
            ? "flex h-row shrink-0 items-center gap-1 rounded bg-accent px-gap whitespace-nowrap text-accent-ink disabled:opacity-50"
            : "flex h-row shrink-0 items-center gap-1 rounded border border-line px-gap whitespace-nowrap text-ink disabled:opacity-50"
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
