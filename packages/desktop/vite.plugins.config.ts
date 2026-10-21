/**
 * Builds each built-in plugin into `dist/resources/plugins/<id>/` beside its manifest, so the
 * engine finds it through the same loader as a user plugin (decision 005) and never imports it.
 */
import { copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import {
  ALIASES,
  BUILD_TARGET,
  DIST_ROOT,
  NODE_CONDITIONS,
  NODE_EXTERNALS,
  NODE_MAIN_FIELDS,
  REPOSITORY_ROOT,
} from "./vite.shared.js";

/** postgres and mysql join this list when their plugins have a source entry. */
const BUILT_IN_PLUGINS = ["sqlite"] as const;
const PLUGINS_SOURCE_ROOT = resolve(REPOSITORY_ROOT, "plugins");
const PLUGINS_OUT_DIR = resolve(DIST_ROOT, "resources/plugins");
const PLUGIN_ENTRY_FILE = "index.js";
const PLUGIN_SOURCE_ENTRY = "src/index.ts";
/** Mirrors `MANIFEST_FILE` in plugin-api; a Vite config loads in plain Node and cannot import TypeScript source. */
const MANIFEST_FILE = "table-craft-plugin.json";

function copyManifests(): Plugin {
  return {
    name: "table-craft:copy-plugin-manifests",
    async writeBundle() {
      await Promise.all(
        BUILT_IN_PLUGINS.map((id) =>
          copyFile(resolve(PLUGINS_SOURCE_ROOT, id, MANIFEST_FILE), resolve(PLUGINS_OUT_DIR, id, MANIFEST_FILE)),
        ),
      );
    },
  };
}

export default defineConfig({
  plugins: [copyManifests()],
  resolve: { alias: ALIASES, mainFields: NODE_MAIN_FIELDS, conditions: NODE_CONDITIONS },
  build: {
    target: BUILD_TARGET,
    outDir: PLUGINS_OUT_DIR,
    emptyOutDir: true,
    lib: {
      entry: Object.fromEntries(
        BUILT_IN_PLUGINS.map((id) => [id, resolve(PLUGINS_SOURCE_ROOT, id, PLUGIN_SOURCE_ENTRY)]),
      ),
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}/${PLUGIN_ENTRY_FILE}`,
    },
    sourcemap: true,
    minify: false,
    rolldownOptions: {
      external: NODE_EXTERNALS,
      // A chunk shared between two plugins would land outside both directories, and the loader
      // refuses an entry that reaches outside its own (decision 005). Each plugin carries its own copy.
      output: { codeSplitting: false },
    },
  },
});
