import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const WORKSPACE_ROOT = import.meta.dirname;
const TEST_FILES = ["test/**/*.test.ts"];
const DB_TEST_FILES = ["test/db/**"];
const TEST_TIMEOUT_MS = 20_000;
const CODEMIRROR = resolve(WORKSPACE_ROOT, "packages/desktop/node_modules/@codemirror");

/** One Vitest project over `test/`; the packages only carry build config. */
export default defineConfig({
  resolve: {
    alias: [
      { find: "@table-craft/plugin-api", replacement: resolve(WORKSPACE_ROOT, "packages/plugin-api/src") },
      { find: "@table-craft/core", replacement: resolve(WORKSPACE_ROOT, "packages/core/src") },
      { find: "@table-craft/desktop", replacement: resolve(WORKSPACE_ROOT, "packages/desktop/src") },
      { find: "@table-craft/plugin-sqlite", replacement: resolve(WORKSPACE_ROOT, "plugins/sqlite/src/index.ts") },
      { find: "@table-craft/plugin-postgres", replacement: resolve(WORKSPACE_ROOT, "plugins/postgres/src/index.ts") },
      { find: "@table-craft/plugin-mysql", replacement: resolve(WORKSPACE_ROOT, "plugins/mysql/src/index.ts") },
      // CodeMirror is the renderer's dependency; renderer tests build editor states with the same copy.
      { find: /^@codemirror\/(.*)$/, replacement: `${CODEMIRROR}/$1` },
    ],
  },
  test: {
    include: TEST_FILES,
    // Needs Docker; `bun run test:db` runs these with their own config (decision 013).
    exclude: DB_TEST_FILES,
    environment: "node",
    testTimeout: TEST_TIMEOUT_MS,
  },
});
