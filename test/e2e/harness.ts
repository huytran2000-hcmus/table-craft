/**
 * Drives the built app under Playwright: launch it against a datasource, run statements, read the
 * grid, and save window screenshots as plan evidence (decision 016). Needs a fresh build of
 * `packages/desktop` and a display.
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
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
const USER_DATA_ENV = "TABLE_CRAFT_USER_DATA";
const USER_DATA_PREFIX = "table-craft-smoke-";

/** The window's default size, so evidence shows the whole shell (plan 003). */
export const EVIDENCE_WINDOW = { width: 1200, height: 800 } as const;

export interface Datasource {
  readonly id: string;
  readonly pluginId: string;
  readonly config: unknown;
}

export interface RunningApp {
  readonly app: ElectronApplication;
  readonly page: Page;
  /** The profile directory; pass it to `launchApp` again to relaunch with the same layout. */
  readonly userDataDir: string;
}

export interface LaunchOptions {
  /** Defaults to a fresh temporary directory, so nothing persists between launches. */
  readonly userDataDir?: string;
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
export async function launchApp(datasource?: Datasource, options: LaunchOptions = {}): Promise<RunningApp> {
  const env = { ...process.env } as Record<string, string>;
  delete env[DATASOURCE_ENV];
  if (datasource !== undefined) env[DATASOURCE_ENV] = JSON.stringify(datasource);
  const userDataDir = options.userDataDir ?? mkdtempSync(join(tmpdir(), USER_DATA_PREFIX));
  env[USER_DATA_ENV] = userDataDir;
  const app = await _electron.launch({ executablePath: electronBinary(), args: [MAIN_ENTRY], env });
  const page = await app.firstWindow();
  return { app, page, userDataDir };
}

export async function setWindowSize(app: ElectronApplication, size: { width: number; height: number }): Promise<void> {
  await app.evaluate(({ BrowserWindow }, { width, height }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(width, height);
  }, size);
}

/** Exact, because other controls' names contain "Run" (e.g. a palette row "Run ⌘↩"). */
export function runButton(page: Page) {
  return page.getByRole("button", { name: "Run", exact: true });
}

export function cancelButton(page: Page) {
  return page.getByRole("button", { name: "Cancel", exact: true });
}

/** Resolves once the session is open and Run is enabled. */
export async function waitUntilReady(page: Page): Promise<void> {
  const run = runButton(page);
  await expect.poll(() => run.isEnabled(), { timeout: LAUNCH_TIMEOUT_MS }).toBe(true);
}

/** Types `sql` into the console and presses Run, without waiting for the answer. */
export async function startStatement(page: Page, sql: string): Promise<void> {
  await page.getByLabel("SQL console").fill(sql);
  await runButton(page).click();
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

/** A tool window by title, e.g. "Database"; absent from the page while hidden. */
export function toolWindow(page: Page, title: string) {
  return page.getByRole("region", { name: title, exact: true });
}

export function editorTabs(page: Page) {
  return page.getByRole("tablist", { name: "Editor tabs" }).getByRole("tab");
}

export function activeEditorTab(page: Page) {
  return page.getByRole("tablist", { name: "Editor tabs" }).getByRole("tab", { selected: true });
}

export function datasourceStatus(page: Page) {
  return page.getByTestId("status-datasource");
}

/** Presses a chord with the platform's Mod (⌘ on macOS, Ctrl elsewhere), e.g. `pressChord(page, "Shift+A")`. */
export async function pressChord(page: Page, keys: string): Promise<void> {
  await page.keyboard.press(`ControlOrMeta+${keys}`);
}

/** Two Shift taps, well inside the double-tap window. */
export async function pressDoubleShift(page: Page): Promise<void> {
  await page.keyboard.press("Shift");
  await page.keyboard.press("Shift");
}

export function paletteInput(page: Page, mode: "Find Action" | "Search Everywhere") {
  return page.getByRole("textbox", { name: mode, exact: true });
}

export function paletteRows(page: Page) {
  return page.getByRole("listbox", { name: "Results" }).getByRole("option");
}

/** Opens Find Action, types `query` and runs the top result. */
export async function findAction(page: Page, query: string): Promise<void> {
  await pressChord(page, "Shift+A");
  await paletteInput(page, "Find Action").fill(query);
  await page.keyboard.press("Enter");
}

/** Saves the window as `<EVIDENCE_DIR>/<name>.png` at CSS pixel scale, when evidence is wanted. */
export async function captureWindow(page: Page, name: string): Promise<void> {
  if (EVIDENCE_DIR === undefined || EVIDENCE_DIR === "") return;
  const directory = resolve(REPOSITORY_ROOT, EVIDENCE_DIR);
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: join(directory, `${name}.png`), scale: "css" });
}
