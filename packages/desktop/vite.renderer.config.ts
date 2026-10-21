import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { ALIASES, DIST_ROOT, SOURCE_ROOT } from "./vite.shared.js";

// `base` is relative because the app loads the renderer over `file://`, where an absolute
// `/assets/...` resolves to the filesystem root.
const RENDERER_ROOT = resolve(SOURCE_ROOT, "renderer");
const RENDERER_TARGET = "chrome130";
const RELATIVE_BASE = "./";

export default defineConfig({
  root: RENDERER_ROOT,
  base: RELATIVE_BASE,
  plugins: [react(), tailwindcss()],
  resolve: { alias: ALIASES },
  build: {
    target: RENDERER_TARGET,
    outDir: resolve(DIST_ROOT, "renderer"),
    emptyOutDir: true,
    sourcemap: true,
  },
});
