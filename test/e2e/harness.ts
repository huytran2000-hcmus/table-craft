/**
 * Drives the built app under Playwright: launch it against a datasource, run statements, read the
 * grid, and save window screenshots as plan evidence (decision 016). Needs a fresh build of
 * `packages/desktop` and a display.
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { _electron, type ElectronApplication, type Page } from "playwright-core";
import { expect } from "vitest";

export const SMOKE_ENABLED = process.env["TABLE_CRAFT_SMOKE"] === "1";
/** Set by `bun run test:smoke:db`, which starts the `test/db` containers first. */
export const DATABASES_ENABLED = SMOKE_ENABLED && process.env["TABLE_CRAFT_SMOKE_DATABASES"] === "1";
/** When set, `captureWindow` saves PNGs there; otherwise it does nothing. */
const EVIDENCE_DIR = process.env["TABLE_CRAFT_EVIDENCE_DIR"];

export const LAUNCH_TIMEOUT_MS = 30_000;
export const SCENARIO_TIMEOUT_MS = LAUNCH_TIMEOUT_MS * 2;

const REPOSITORY_ROOT = resolve(import.meta.dirname, "../..");
const DESKTOP_ROOT = join(REPOSITORY_ROOT, "packages/desktop");
const MAIN_ENTRY = join(DESKTOP_ROOT, "dist/main/main.js");
const DATASOURCE_ENV = "TABLE_CRAFT_DATASOURCE";

/** Small enough to keep evidence PNGs light, wide enough for the `type_probe` columns. */
export const EVIDENCE_WINDOW = { width: 1280, height: 300 } as const;

export interface Datasource {
  readonly id: string;
  readonly pluginId: string;
  readonly config: unknown;
}

export interface RunningApp {
  readonly app: ElectronApplication;
  readonly page: Page;
}

export interface GridText {
  readonly headers: readonly string[];
  readonly cells: readonly string[];
}

/** The `electron` package exports the path of the binary it installed, downloading it on first use. */
function electronBinary(): string {
  return createRequire(join(DESKTOP_ROOT, "package.json"))("electron") as string;
}

/** Launches the app; without a datasource it opens the in-memory SQLite scratch database. */
export async function launchApp(datasource?: Datasource): Promise<RunningApp> {
  const env = { ...process.env } as Record<string, string>;
  delete env[DATASOURCE_ENV];
  if (datasource !== undefined) env[DATASOURCE_ENV] = JSON.stringify(datasource);
  const app = await _electron.launch({ executablePath: electronBinary(), args: [MAIN_ENTRY], env });
  const page = await app.firstWindow();
  return { app, page };
}

export async function setWindowSize(app: ElectronApplication, size: { width: number; height: number }): Promise<void> {
  await app.evaluate(({ BrowserWindow }, { width, height }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(width, height);
  }, size);
}

/** Resolves once the session is open and Run is enabled. */
export async function waitUntilReady(page: Page): Promise<void> {
  const run = page.getByRole("button", { name: "Run" });
  await expect.poll(() => run.isEnabled(), { timeout: LAUNCH_TIMEOUT_MS }).toBe(true);
}

/** Types `sql` into the console and presses Run, without waiting for the answer. */
export async function startStatement(page: Page, sql: string): Promise<void> {
  await page.getByLabel("SQL console").fill(sql);
  await page.getByRole("button", { name: "Run" }).click();
}

/** Runs a row-returning or failing `sql` and resolves once its grid or its error is shown. */
export async function runStatement(page: Page, sql: string): Promise<void> {
  await startStatement(page, sql);
  await page.getByRole("columnheader").or(consoleAlert(page)).first().waitFor({ timeout: LAUNCH_TIMEOUT_MS });
  await waitUntilReady(page);
}

export async function gridText(page: Page): Promise<GridText> {
  return {
    headers: await page.getByRole("columnheader").allTextContents(),
    cells: await page.getByRole("gridcell").allTextContents(),
  };
}

export function consoleAlert(page: Page) {
  return page.getByRole("alert");
}

/** Saves the window as `<EVIDENCE_DIR>/<name>.png` at CSS pixel scale, when evidence is wanted. */
export async function captureWindow(page: Page, name: string): Promise<void> {
  if (EVIDENCE_DIR === undefined || EVIDENCE_DIR === "") return;
  const directory = resolve(REPOSITORY_ROOT, EVIDENCE_DIR);
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: join(directory, `${name}.png`), scale: "css" });
}
