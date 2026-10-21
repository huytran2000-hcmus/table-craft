import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const WORKSPACE_ROOT = import.meta.dirname;
const TEST_FILES = ["test/**/*.test.ts"];
const DB_TEST_FILES = ["test/db/**"];
const TEST_TIMEOUT_MS = 20_000;

/** One Vitest project over `test/`; the packages only carry build config. */
export default defineConfig({
  resolve: {
    alias: {
      "@table-craft/plugin-api": resolve(WORKSPACE_ROOT, "packages/plugin-api/src"),
      "@table-craft/core": resolve(WORKSPACE_ROOT, "packages/core/src"),
      "@table-craft/desktop": resolve(WORKSPACE_ROOT, "packages/desktop/src"),
      "@table-craft/plugin-sqlite": resolve(WORKSPACE_ROOT, "plugins/sqlite/src/index.ts"),
    },
  },
  test: {
    include: TEST_FILES,
    // Needs Docker; `bun run test:db` runs these with their own config (decision 013).
    exclude: DB_TEST_FILES,
    environment: "node",
    testTimeout: TEST_TIMEOUT_MS,
  },
});
