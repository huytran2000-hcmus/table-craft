/**
 * What the desktop builds agree on. One `vite build` per runtime rather than one build, because
 * main, preload, engine, renderer and the built-in plugins run in different places, and pretending
 * otherwise is how a `node:fs` import ends up in a browser bundle.
 */
import { builtinModules } from "node:module";
import { resolve } from "node:path";

export const BUILD_TARGET = "node20";
export const PACKAGE_ROOT = import.meta.dirname;
export const REPOSITORY_ROOT = resolve(PACKAGE_ROOT, "../..");
export const SOURCE_ROOT = resolve(PACKAGE_ROOT, "src");
export const DIST_ROOT = resolve(PACKAGE_ROOT, "dist");
export const NODE_MAIN_FIELDS = ["module", "jsnext:main", "jsnext", "main"];
export const NODE_CONDITIONS = ["node"];

export const ALIASES = {
  "@table-craft/plugin-api": resolve(REPOSITORY_ROOT, "packages/plugin-api/src"),
  "@table-craft/core": resolve(REPOSITORY_ROOT, "packages/core/src"),
  "@table-craft/desktop": SOURCE_ROOT,
};

const NODE_BUILTINS = builtinModules.flatMap((moduleName) => {
  const bareName = moduleName.replace(/^node:/, "");
  return [bareName, `node:${bareName}`];
});

/**
 * `builtinModules` omits the modules that exist only under the `node:` scheme, such as `node:sqlite`,
 * so the scheme itself is external too; otherwise Vite swaps them for an empty browser shim.
 */
const NODE_SCHEME = /^node:/;

/** Workspace packages and zod are inlined; only what the runtime itself provides stays external. */
export const NODE_EXTERNALS = [...NODE_BUILTINS, NODE_SCHEME, "electron"];
