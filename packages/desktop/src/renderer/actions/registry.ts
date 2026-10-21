import type { Chord } from "@table-craft/desktop/renderer/actions/chords.js";
import type { ActionContext } from "@table-craft/desktop/renderer/actions/context.js";

/** Every command the app has is one of these (decision 015): menus, palette, keymap and buttons only `invoke`. */
export type ActionCategory = "Console" | "Editor Tabs" | "Tool Windows" | "Navigation";

/** Names, not components, so the registry stays free of React; `ui/icons.ts` maps them. */
export type ActionIcon = "run" | "cancel" | "newConsole" | "close" | "database" | "services" | "search";

export interface Action<A = void> {
  readonly id: string;
  readonly title: string;
  readonly category: ActionCategory;
  readonly icon?: ActionIcon;
  readonly shortcut?: Chord;
  /** Whether the action can run now; absent means always. */
  readonly when?: (context: ActionContext) => boolean;
  readonly run: (context: ActionContext, args: A) => void | Promise<void>;
}

/** Stored without its argument type; `never` because every `Action<A>` accepts it. */
export type AnyAction = Action<never>;

export type InvokeOutcome = "ran" | "disabled" | "unknown";

export function defineAction<A = void>(action: Action<A>): Action<A> {
  return action;
}

export interface ActionRegistry {
  register(actions: readonly AnyAction[]): void;
  /** The only way anything runs a command. */
  invoke(id: string, args?: unknown): InvokeOutcome;
  isEnabled(id: string, context?: ActionContext): boolean;
  get(id: string): AnyAction | undefined;
  all(): readonly AnyAction[];
  /** Called after every action that ran, with its id. */
  onInvoked(listener: (id: string) => void): () => void;
}

export function createActionRegistry(
  contextOf: () => ActionContext,
  reportFailure: (id: string, cause: unknown) => void = () => undefined,
): ActionRegistry {
  const actions = new Map<string, AnyAction>();
  const listeners = new Set<(id: string) => void>();

  function enabled(action: AnyAction, context: ActionContext): boolean {
    return action.when?.(context) ?? true;
  }

  return {
    register(added) {
      for (const action of added) {
        const existing = actions.get(action.id);
        if (existing !== undefined) {
          throw new Error(
            `Action id "${action.id}" is registered twice: "${existing.title}" and "${action.title}". Give one a new id.`,
          );
        }
        actions.set(action.id, action);
      }
    },
    invoke(id, args) {
      const action = actions.get(id);
      if (action === undefined) return "unknown";
      const context = contextOf();
      if (!enabled(action, context)) return "disabled";
      try {
        void Promise.resolve(action.run(context, args as never)).catch((cause: unknown) => reportFailure(id, cause));
      } catch (cause) {
        reportFailure(id, cause);
      }
      for (const listener of listeners) listener(id);
      return "ran";
    },
    isEnabled(id, context = contextOf()) {
      const action = actions.get(id);
      return action !== undefined && enabled(action, context);
    },
    get: (id) => actions.get(id),
    all: () => [...actions.values()],
    onInvoked(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
