/**
 * Renders `build/icon.svg` to `build/icon.png` at 1024×1024, from which electron-builder derives
 * `.icns` and `.ico` (plan 014 decision 7). Run once after editing the SVG and commit both:
 * `node --experimental-strip-types packages/desktop/scripts/render-icon.ts`. It draws with
 * Electron's own Chromium through Playwright, because playwright-core downloads no browser of its
 * own; under Bun, Playwright's connection to Electron never completes, so it runs on Node.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron } from "playwright-core";

const PACKAGE_ROOT = join(import.meta.dirname, "..");
const SOURCE = join(PACKAGE_ROOT, "build", "icon.svg");
const TARGET = join(PACKAGE_ROOT, "build", "icon.png");
const ICON_SIZE_PX = 1024;
const BLANK_WINDOW_MAIN = `
const { app, BrowserWindow } = require("electron");
app.whenReady().then(() => {
  const window = new BrowserWindow({ width: ${ICON_SIZE_PX}, height: ${ICON_SIZE_PX}, show: false, frame: false, transparent: true, useContentSize: true });
  void window.loadURL("about:blank");
});
`;

const electron = createRequire(join(PACKAGE_ROOT, "package.json"))("electron") as string;
const svg = await readFile(SOURCE, "utf8");
const scratch = await mkdtemp(join(tmpdir(), "table-craft-icon-"));
const main = join(scratch, "main.cjs");
await writeFile(main, BLANK_WINDOW_MAIN);
const app = await _electron.launch({ executablePath: electron, args: [main] });
try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: ICON_SIZE_PX, height: ICON_SIZE_PX });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.locator("svg").screenshot({ path: TARGET, omitBackground: true, scale: "css" });
  console.log(`Wrote ${TARGET}`);
} finally {
  await app.close();
  await rm(scratch, { recursive: true, force: true });
}
