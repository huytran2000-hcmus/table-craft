import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const SOURCE_FILES = ["packages/*/src/**/*.ts", "packages/*/src/**/*.tsx", "plugins/*/src/**/*.ts"];
const PLUGIN_API_FILES = ["packages/plugin-api/src/**/*.ts"];
const CORE_FILES = ["packages/core/src/**/*.ts"];
const PLUGIN_FILES = ["plugins/*/src/**/*.ts"];
const DESKTOP_FILES = ["packages/desktop/src/**/*.ts", "packages/desktop/src/**/*.tsx"];
const RENDERER_FILES = ["packages/desktop/src/renderer/**/*.ts", "packages/desktop/src/renderer/**/*.tsx"];
const TEST_FILES = ["test/**/*.ts"];

const SOURCE_IMPORT_PATTERNS = ["../*", "../**"];
const TEST_SOURCE_IMPORT_PATTERNS = [
  "**/packages/*/src/*",
  "**/packages/*/src/**",
  "**/plugins/*/src/*",
  "**/plugins/*/src/**",
];
const ALIAS_IMPORT_RULE =
  "Cross-directory imports use the @table-craft/* aliases; imports within a directory stay relative.";

const ELECTRON_IMPORTS = ["electron", "electron/**"];
const CORE_IMPORTS = ["@table-craft/core", "@table-craft/core/**"];
const DESKTOP_IMPORTS = ["@table-craft/desktop", "@table-craft/desktop/**"];
const BUILT_IN_PLUGIN_IMPORTS = [
  "@table-craft/plugin-postgres",
  "@table-craft/plugin-mysql",
  "@table-craft/plugin-sqlite",
];

/** The contract third parties compile against: zod and nothing else (decision 004). */
const PLUGIN_API_PURITY_IMPORTS = [...CORE_IMPORTS, ...DESKTOP_IMPORTS, ...ELECTRON_IMPORTS, "node:*"];
const PLUGIN_API_PURITY_RULE = "plugin-api is the published contract. It may depend on zod alone.";

/** Core may not know a window exists, and reaches plugins only through the loader (decision 005). */
const CORE_PURITY_IMPORTS = [...DESKTOP_IMPORTS, ...ELECTRON_IMPORTS, ...BUILT_IN_PLUGIN_IMPORTS];
const CORE_PURITY_RULE =
  "Core knows nothing about Electron, and plugins arrive through the runtime loader, never an import.";

/** A built-in plugin proves the contract is sufficient by using nothing else (decision 004). */
const PLUGIN_PURITY_IMPORTS = [...CORE_IMPORTS, ...DESKTOP_IMPORTS, ...ELECTRON_IMPORTS];
const PLUGIN_PURITY_RULE = "A plugin depends on @table-craft/plugin-api and its driver, nothing else.";

const DESKTOP_PLUGIN_RULE = "Plugins load at runtime through the core loader (decision 005), never by import.";

/**
 * The renderer is a browser. If it can import core or a driver, someone eventually will, and the
 * three-process model collapses into one (decision 002).
 */
const RENDERER_FENCE_IMPORTS = [
  ...CORE_IMPORTS,
  ...ELECTRON_IMPORTS,
  "@table-craft/plugin-*",
  "@table-craft/plugin-*/**",
  "node:*",
];
const RENDERER_FENCE_GLOBALS = ["process", "Buffer", "require", "__dirname", "__filename", "global"];
const RENDERER_FENCE_RULE =
  "The renderer is a pure view. Reach the engine over the port; import types from @table-craft/desktop/engine/protocol.js.";

/** @param {...{ group: string[], message: string }} groups */
function restrictImports(...groups) {
  return [
    "error",
    {
      patterns: [{ group: SOURCE_IMPORT_PATTERNS, message: ALIAS_IMPORT_RULE }, ...groups],
    },
  ];
}

export default tseslint.config(
  {
    ignores: ["dist/**", "**/dist/**", "node_modules/**", "release/**", "test/fixtures/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.js"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: SOURCE_FILES,
    rules: { "no-restricted-imports": restrictImports() },
  },
  {
    files: PLUGIN_API_FILES,
    rules: {
      "no-restricted-imports": restrictImports({ group: PLUGIN_API_PURITY_IMPORTS, message: PLUGIN_API_PURITY_RULE }),
    },
  },
  {
    files: CORE_FILES,
    rules: {
      "no-restricted-imports": restrictImports({ group: CORE_PURITY_IMPORTS, message: CORE_PURITY_RULE }),
    },
  },
  {
    files: PLUGIN_FILES,
    rules: {
      "no-restricted-imports": restrictImports({ group: PLUGIN_PURITY_IMPORTS, message: PLUGIN_PURITY_RULE }),
    },
  },
  {
    files: DESKTOP_FILES,
    rules: {
      "no-restricted-imports": restrictImports({ group: BUILT_IN_PLUGIN_IMPORTS, message: DESKTOP_PLUGIN_RULE }),
    },
  },
  {
    files: RENDERER_FILES,
    extends: [reactHooks.configs.flat["recommended-latest"]],
    rules: {
      "react-hooks/exhaustive-deps": "error",
      "no-restricted-imports": restrictImports({ group: RENDERER_FENCE_IMPORTS, message: RENDERER_FENCE_RULE }),
      "no-restricted-globals": [
        "error",
        ...RENDERER_FENCE_GLOBALS.map((name) => ({ name, message: RENDERER_FENCE_RULE })),
      ],
    },
  },
  {
    files: TEST_FILES,
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: TEST_SOURCE_IMPORT_PATTERNS, message: ALIAS_IMPORT_RULE }] },
      ],
    },
  },
  prettier,
);
