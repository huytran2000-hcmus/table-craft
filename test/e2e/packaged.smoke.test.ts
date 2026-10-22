/**
 * Plan 014's packaged-app suite: the unpacked app electron-builder produced, not the development
 * build, so the bundles in `app.asar`, the plugins in `<resources>/plugins` and the bundled drivers
 * are what run. Runs only when `TABLE_CRAFT_APP_EXECUTABLE` names that app:
 *
 *   bun run test:smoke:packaged        # SQLite only, as CI runs it
 *   TABLE_CRAFT_EVIDENCE_DIR=docs/evidence/014 bun run test:smoke:packaged:db
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { appVersion, systemGit } from "../../packages/desktop/scripts/version.js";
import { MYSQL_CONFIG, POSTGRES_CONFIG } from "../support/databases.js";
import { seededSqliteFile } from "../support/sqliteFixture.js";
import {
  activeEditorTab,
  answerSecretPrompt,
  APP_EXECUTABLE,
  CLOSE_HOOK_TIMEOUT_MS,
  closeApp,
  DATABASES_ENABLED,
  dataSourcesDialog,
  EVIDENCE_WINDOW,
  evidenceFor,
  findAction,
  gridText,
  LAUNCH_TIMEOUT_MS,
  launchApp,
  newProfile,
  openConsoleOn,
  pressChord,
  runStatement,
  SCENARIO_TIMEOUT_MS,
  seedDatasources,
  setWindowSize,
  SMOKE_ENABLED,
  toolWindow,
  treeNode,
  waitUntilReady,
} from "./harness.js";
import type { RunningApp, SavedDatasource } from "./harness.js";
import { DAILY_LOOP_STEPS, dailyLoop, stubSaveDialog } from "./workflows.js";

const captureWindow = evidenceFor("014");
const LOOP_TIMEOUT_MS = SCENARIO_TIMEOUT_MS * 3;
const BUILT_IN_KINDS = ["MySQL", "PostgreSQL", "SQLite"];
/** Not the default on a light-mode host, so the relaunched window shows it was kept. */
const CHOSEN_THEME = "Dark";
const PASSWORD = POSTGRES_CONFIG.password;

const { password: _postgresPassword, ...POSTGRES_PLAIN } = POSTGRES_CONFIG;
const { password: _mysqlPassword, ...MYSQL_PLAIN } = MYSQL_CONFIG;

const SAVED_POSTGRES: SavedDatasource = {
  id: "pg",
  name: "pg",
  pluginId: "postgres",
  config: { ...POSTGRES_PLAIN, sslMode: "disable" },
  secretModes: { password: "untilRestart" },
};
const SAVED_MYSQL: SavedDatasource = {
  id: "mysql",
  name: "mysql",
  pluginId: "mysql",
  config: { ...MYSQL_PLAIN, sslMode: "disable" },
  secretModes: { password: "untilRestart" },
};

function savedSqlite(): SavedDatasource {
  return { id: "sqlite", name: "sqlite", pluginId: "sqlite", config: { path: seededSqliteFile() } };
}

function settingsDialog(page: Page) {
  return page.getByRole("dialog", { name: "Settings" });
}

function themeOption(page: Page, name: string) {
  return settingsDialog(page).getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name, exact: true });
}

async function openAppearance(page: Page): Promise<void> {
  await pressChord(page, ",");
  await settingsDialog(page).waitFor({ timeout: LAUNCH_TIMEOUT_MS });
  await settingsDialog(page).getByRole("tab", { name: "Appearance", exact: true }).click();
}

describe.runIf(SMOKE_ENABLED && APP_EXECUTABLE !== undefined)("packaged app", () => {
  let running: RunningApp | null = null;
  const scratch: string[] = [];

  async function closeRunning(): Promise<void> {
    const current = running;
    running = null;
    await closeApp(current?.app);
  }

  afterEach(async () => {
    await closeRunning();
    for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
  }, CLOSE_HOOK_TIMEOUT_MS);

  async function launchSaved(datasources: readonly SavedDatasource[], userDataDir = newProfile()): Promise<RunningApp> {
    seedDatasources(userDataDir, datasources);
    running = await launchApp(null, { userDataDir });
    await setWindowSize(running.app, EVIDENCE_WINDOW);
    await toolWindow(running.page, "Database").waitFor({ timeout: LAUNCH_TIMEOUT_MS });
    return running;
  }

  it(
    "givenPackagedApp_whenLaunched_thenAllBuiltInPluginsAvailable",
    async () => {
      const { app, page } = await launchSaved([]);
      expect(await app.evaluate(({ app: electron }) => electron.isPackaged)).toBe(true);

      await toolWindow(page, "Database").getByRole("button", { name: "New Data Source…", exact: true }).click();

      const kinds = dataSourcesDialog(page).getByRole("list", { name: "Database kinds" }).getByRole("button");
      await expect.poll(() => kinds.count(), { timeout: LAUNCH_TIMEOUT_MS }).toBe(BUILT_IN_KINDS.length);
      expect([...(await kinds.allTextContents())].sort()).toEqual(BUILT_IN_KINDS);
      for (const kind of await kinds.all()) expect(await kind.isEnabled()).toBe(true);
      await captureWindow(page, "packaged-plugins");
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    "givenPackagedApp_whenLaunched_thenVersionIsTheBuiltOne",
    async () => {
      const version = appVersion(systemGit);
      const { app, page } = await launchSaved([]);

      expect(await app.evaluate(({ app: electron }) => electron.getVersion())).toBe(version);
      await findAction(page, "About table-craft");
      const about = page.getByRole("dialog").filter({ hasText: `table-craft ${version}` });
      await about.waitFor({ timeout: LAUNCH_TIMEOUT_MS });
      expect(await about.textContent()).toMatch(/Electron \d+\.\d+\.\d+ · Chromium \d+/);
      await captureWindow(page, "packaged-about");
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    "givenPackagedApp_whenDailyLoopOnSqlite_thenEveryStepSucceeds",
    async () => {
      const saved = savedSqlite();
      const { app, page } = await launchSaved([saved]);
      const folder = mkdtempSync(join(tmpdir(), "table-craft-loop-"));
      scratch.push(folder);
      const exportPath = join(folder, "customers.csv");
      await stubSaveDialog(app, exportPath);

      const steps = await dailyLoop(page, { name: saved.name, namespace: "main", exportPath });

      expect(steps).toEqual(DAILY_LOOP_STEPS);
      await captureWindow(page, "packaged-loop");
    },
    LOOP_TIMEOUT_MS,
  );

  it(
    "givenPackagedApp_whenSettingChangedAndRelaunched_thenKept",
    async () => {
      const userDataDir = newProfile();
      const saved = savedSqlite();
      const first = await launchSaved([saved], userDataDir);
      await openAppearance(first.page);
      await themeOption(first.page, CHOSEN_THEME).click();
      await expect.poll(() => themeOption(first.page, CHOSEN_THEME).getAttribute("aria-checked")).toBe("true");
      await closeRunning();

      const { page } = await launchSaved([saved], userDataDir);
      await openConsoleOn(page, saved.name);
      await waitUntilReady(page);
      await openAppearance(page);

      expect(await themeOption(page, CHOSEN_THEME).getAttribute("aria-checked")).toBe("true");
      await captureWindow(page, "packaged-relaunch");
    },
    SCENARIO_TIMEOUT_MS * 2,
  );

  it.runIf(DATABASES_ENABLED)(
    "givenPackagedApp_whenPostgresAndMysqlConnected_thenSelectOneReturns",
    async () => {
      const { page } = await launchSaved([SAVED_POSTGRES, SAVED_MYSQL]);

      for (const saved of [SAVED_POSTGRES, SAVED_MYSQL]) {
        await openConsoleOn(page, saved.name);
        await answerSecretPrompt(page, saved.name, PASSWORD);
        await waitUntilReady(page);
        await expect.poll(() => activeEditorTab(page).textContent()).toBe(`console [${saved.name}]`);
        await expect.poll(() => treeNode(page, saved.name).getAttribute("data-state")).toBe("connected");

        await runStatement(page, "SELECT 1 AS one");

        expect(await gridText(page)).toEqual({ headers: ["one"], cells: ["1"] });
      }
      await captureWindow(page, "packaged-drivers");
    },
    SCENARIO_TIMEOUT_MS,
  );
});
