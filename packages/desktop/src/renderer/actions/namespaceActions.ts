import type { ActionContext } from "@table-craft/desktop/renderer/actions/context.js";
import { defineAction, type AnyAction } from "@table-craft/desktop/renderer/actions/registry.js";
import { switchBlocked } from "@table-craft/desktop/renderer/model/namespaceSwitcher.js";
import { canRun, useConsoles } from "@table-craft/desktop/renderer/state/consoles.js";
import { useNamespaceSwitcher } from "@table-craft/desktop/renderer/state/namespaceSwitcher.js";

export const NAMESPACE_ACTION_IDS = {
  switchNamespace: "console.switchNamespace",
} as const;

/** A target picked in the dropdown; without it the action opens the dropdown. */
export interface SwitchNamespaceArgs {
  readonly path: readonly string[];
}

const canSwitch = (context: ActionContext) =>
  context.console !== null && canRun(context.console.status) && switchBlocked(context.console) === null;

/** The console's database or schema switcher (decision 060). */
export const NAMESPACE_ACTIONS: readonly AnyAction[] = [
  defineAction<SwitchNamespaceArgs | undefined>({
    // No chord: the toolbar label and the palette reach it, and every free one is taken by plans in flight.
    id: NAMESPACE_ACTION_IDS.switchNamespace,
    title: "Switch Database/Schema…",
    category: "Console",
    tabKind: "console",
    available: (context) => context.capabilities.includes("currentNamespace"),
    when: canSwitch,
    run: async (context, args) => {
      const consoleId = context.activeTab?.id;
      if (consoleId === undefined) return;
      if (args === undefined) {
        await useNamespaceSwitcher.getState().show(consoleId);
        return;
      }
      useNamespaceSwitcher.getState().hide();
      await useConsoles.getState().switchNamespace(consoleId, args.path);
    },
  }),
];
