/**
 * Set by `vite.main.config.ts` from `TABLE_CRAFT_UPDATE_TEST_BUILD=1` at build time; absent (so
 * false) in every other build, including the release workflow's, which refuses the variable.
 */
declare const __TABLE_CRAFT_UPDATE_TEST_BUILD__: boolean | undefined;

/** A build the live test packages: it honours the update overrides and keeps its own name, profile and keychain item. */
export const UPDATE_TEST_BUILD: boolean =
  typeof __TABLE_CRAFT_UPDATE_TEST_BUILD__ !== "undefined" && __TABLE_CRAFT_UPDATE_TEST_BUILD__;
