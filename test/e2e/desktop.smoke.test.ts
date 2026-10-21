/**
 * Launches the built app and runs a statement through every process. Gated, because it needs a
 * display and a fresh build:
 *
 *   bun run test:smoke
 */
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { _electron, type ElectronApplication } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";

const SMOKE_ENABLED = process.env["TABLE_CRAFT_SMOKE"] === "1";

const DESKTOP_ROOT = resolve(import.meta.dirname, "../../packages/desktop");
const MAIN_ENTRY = join(DESKTOP_ROOT, "dist/main/main.js");
const SMOKE_SQL = "SELECT 1 AS one, 'two' AS two";
const LAUNCH_TIMEOUT_MS = 30_000;

/** The `electron` package exports the path of the binary it installed, downloading it on first use. */
function electronBinary(): string {
  return createRequire(join(DESKTOP_ROOT, "package.json"))("electron") as string;
}

describe.runIf(SMOKE_ENABLED)("desktop smoke", () => {
  let app: ElectronApplication | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  it(
    "givenBuiltApp_whenSelectOneRun_thenGridShowsTheRow",
    async () => {
      app = await _electron.launch({ executablePath: electronBinary(), args: [MAIN_ENTRY] });
      const page = await app.firstWindow();

      const run = page.getByRole("button", { name: "Run" });
      await expect.poll(() => run.isEnabled(), { timeout: LAUNCH_TIMEOUT_MS }).toBe(true);
      await page.getByLabel("SQL console").fill(SMOKE_SQL);
      await run.click();

      const headers = page.getByRole("columnheader");
      await headers.first().waitFor();
      expect(await headers.allTextContents()).toEqual(["one", "two"]);
      expect(await page.getByRole("gridcell").allTextContents()).toEqual(["1", "two"]);
    },
    LAUNCH_TIMEOUT_MS * 2,
  );
});
