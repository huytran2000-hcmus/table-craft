import { APP_ACTIONS } from "@table-craft/desktop/renderer/actions/appActions.js";
import { GRID_ACTIONS } from "@table-craft/desktop/renderer/actions/gridActions.js";
import { EXPLORER_ACTIONS } from "@table-craft/desktop/renderer/actions/explorerActions.js";
import { NAVIGATION_ACTIONS } from "@table-craft/desktop/renderer/actions/navigationActions.js";
import type { AnyAction } from "@table-craft/desktop/renderer/actions/registry.js";
import { TABLE_ACTIONS } from "@table-craft/desktop/renderer/actions/tableActions.js";

/** Every action the app registers; the keymap and menu tests check this list. */
export const ALL_ACTIONS: readonly AnyAction[] = [
  ...APP_ACTIONS,
  ...GRID_ACTIONS,
  ...EXPLORER_ACTIONS,
  ...TABLE_ACTIONS,
  ...NAVIGATION_ACTIONS,
];
