/**
 * Launches the built app and runs a statement through every process. Gated, because it needs a
 * display and a fresh build:
 *
 *   bun run test:smoke
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  gridText,
  launchApp,
  runStatement,
  SCENARIO_TIMEOUT_MS,
  SMOKE_ENABLED,
  waitUntilReady,
  type RunningApp,
} from "./harness.js";

const SMOKE_SQL = "SELECT 1 AS one, 'two' AS two";

describe.runIf(SMOKE_ENABLED)("desktop smoke", () => {
  let running: RunningApp | null = null;

  afterEach(async () => {
    await running?.app.close();
    running = null;
  });

  it(
    "givenBuiltApp_whenSelectOneRun_thenGridShowsTheRow",
    async () => {
      running = await launchApp();
      const { page } = running;
      await waitUntilReady(page);

      await runStatement(page, SMOKE_SQL);

      expect(await gridText(page)).toEqual({ headers: ["one", "two"], cells: ["1", "two"] });
    },
    SCENARIO_TIMEOUT_MS,
  );
});
