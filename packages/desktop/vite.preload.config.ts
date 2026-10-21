import { resolve } from "node:path";
import { defineConfig } from "vite";
import { ALIASES, BUILD_TARGET, DIST_ROOT, NODE_EXTERNALS, SOURCE_ROOT } from "./vite.shared.js";

// A sandboxed preload cannot be an ES module, so this one entry is CommonJS.
const OUT_FILE = "preload.cjs";

export default defineConfig({
  resolve: { alias: ALIASES },
  build: {
    target: BUILD_TARGET,
    outDir: resolve(DIST_ROOT, "preload"),
    emptyOutDir: true,
    lib: {
      entry: resolve(SOURCE_ROOT, "preload/preload.ts"),
      formats: ["cjs"],
      fileName: () => OUT_FILE,
    },
    sourcemap: true,
    minify: false,
    rolldownOptions: { external: NODE_EXTERNALS },
  },
});
