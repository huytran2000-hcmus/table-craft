import { APP_ACTIONS } from "@table-craft/desktop/renderer/actions/appActions.js";
import { EXPLORER_ACTIONS } from "@table-craft/desktop/renderer/actions/explorerActions.js";
import type { AnyAction } from "@table-craft/desktop/renderer/actions/registry.js";

/** Every action the app registers; the keymap and menu tests check this list. */
export const ALL_ACTIONS: readonly AnyAction[] = [...APP_ACTIONS, ...EXPLORER_ACTIONS];
