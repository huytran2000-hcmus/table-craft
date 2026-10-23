/**
 * Plan 020's development-build half: the update check against a local server and a throwaway key,
 * through the overrides an unpackaged build honours. A development run reports 0.0.0 and cannot
 * replace itself, so a newer release shows the button with the reason instead of a download; the
 * download, the swap and the relaunch run against packaged builds in the plan's live test.
 *
 *   TABLE_CRAFT_EVIDENCE_DIR=docs/evidence/020 bun run test:smoke
 */
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLOSE_HOOK_TIMEOUT_MS,
  closeApp,
  EVIDENCE_WINDOW,
  evidenceFor,
  findAction,
  LAUNCH_TIMEOUT_MS,
  launchApp,
  mainToolbar,
  newProfile,
  readProfileFile,
  SCENARIO_TIMEOUT_MS,
  seedSettings,
  setWindowSize,
  SMOKE_ENABLED,
  waitUntilReady,
  type RunningApp,
} from "./harness.js";

const captureWindow = evidenceFor("020");

/** `UPDATE_OVERRIDE_ENV` in `main/update/overrides.ts`; the e2e suite does not import main. */
const MANIFEST_URL_ENV = "TABLE_CRAFT_UPDATE_MANIFEST_URL";
const PUBLIC_KEY_ENV = "TABLE_CRAFT_UPDATE_PUBLIC_KEY";
const FIRST_CHECK_ENV = "TABLE_CRAFT_UPDATE_FIRST_CHECK_MS";
const FIRST_CHECK_MS = 300;
const MANIFEST_PATH = "/releases/latest/download/update-manifest.json";
const SIGNATURE_PATH = `${MANIFEST_PATH}.sig`;
const ASSET_PATH = "/releases/download/v9.0.0/TableCraft-9.0.0.zip";
const UPDATE_SCOPE = "update";
const LOG_FILE = join("logs", "table-craft.log");
const ASSET = Buffer.from("not a real zip; a development build never downloads it");

const KEYS = generateKeyPairSync("ed25519");
const OTHER_KEYS = generateKeyPairSync("ed25519");

interface Release {
  readonly version: string;
  readonly signedBy?: typeof KEYS;
}

interface LocalServer {
  readonly server: Server;
  readonly url: string;
  readonly requests: string[];
}

function manifestOf(version: string, origin: string): Buffer {
  const asset = {
    url: `${origin}${ASSET_PATH}`,
    size: ASSET.byteLength,
    sha256: createHash("sha256").update(ASSET).digest("hex"),
  };
  const assets = Object.fromEntries(
    ["darwin-arm64", "darwin-x64", "win32-x64", "linux-x64", "linux-arm64"].map((key) => [key, asset]),
  );
  return Buffer.from(
    JSON.stringify({ schema: 1, version, notesUrl: "https://example.com/notes", minimumVersion: null, assets }),
  );
}

async function serve(release: Release): Promise<LocalServer> {
  const requests: string[] = [];
  let origin = "";
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    const body = manifestOf(release.version, origin);
    if (request.url === MANIFEST_PATH) response.end(body);
    else if (request.url === SIGNATURE_PATH)
      response.end(sign(null, body, (release.signedBy ?? KEYS).privateKey).toString("base64"));
    else if (request.url === ASSET_PATH) response.end(ASSET);
    else response.writeHead(404).end();
  });
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  return { server, url: `${origin}${MANIFEST_PATH}`, requests };
}

function overrides(local: LocalServer, userDataDir: string): Record<string, string> {
  const keyFile = join(userDataDir, "update-test-key.pem");
  writeFileSync(keyFile, KEYS.publicKey.export({ type: "spki", format: "pem" }).toString());
  return { [MANIFEST_URL_ENV]: local.url, [PUBLIC_KEY_ENV]: keyFile, [FIRST_CHECK_ENV]: String(FIRST_CHECK_MS) };
}

interface LoggedLine {
  readonly level: string;
  readonly scope: string;
  readonly msg: string;
  readonly [field: string]: unknown;
}

function updateLines(userDataDir: string): readonly LoggedLine[] {
  return (readProfileFile(userDataDir, LOG_FILE) ?? "")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as LoggedLine)
    .filter((line) => line.scope === UPDATE_SCOPE);
}

async function loggedUpdate(userDataDir: string, msg: string): Promise<LoggedLine> {
  await expect
    .poll(() => updateLines(userDataDir).some((line) => line.msg === msg), { timeout: LAUNCH_TIMEOUT_MS })
    .toBe(true);
  const line = updateLines(userDataDir).find((candidate) => candidate.msg === msg);
  if (line === undefined) throw new Error(`no update log line "${msg}"`);
  return line;
}

function updateButton(page: Page) {
  return page.getByTestId("update-button");
}

/** The accessible names of the main toolbar's right-hand group, in order. */
async function rightGroupNames(page: Page): Promise<string[]> {
  return mainToolbar(page)
    .locator("button")
    .evaluateAll((buttons) =>
      buttons.slice(-3).map((button) => button.getAttribute("aria-label") ?? button.textContent?.trim() ?? ""),
    );
}

describe.runIf(SMOKE_ENABLED)("in-app update (development build)", () => {
  let running: RunningApp | null = null;
  let local: LocalServer | null = null;

  async function open(release: Release, settings?: object): Promise<RunningApp & { readonly local: LocalServer }> {
    local = await serve(release);
    const userDataDir = newProfile();
    if (settings !== undefined) seedSettings(userDataDir, settings);
    running = await launchApp(undefined, { userDataDir, env: overrides(local, userDataDir) });
    await setWindowSize(running.app, EVIDENCE_WINDOW);
    return { ...running, local };
  }

  afterEach(async () => {
    await closeApp(running?.app);
    running = null;
    local?.server.close();
    local = null;
  }, CLOSE_HOOK_TIMEOUT_MS);

  it(
    "givenNoNewerRelease_whenCheckedAutomaticallyAndFromHelp_thenNoButtonAndUpToDate",
    async () => {
      const { page, userDataDir } = await open({ version: "0.0.0" });
      await waitUntilReady(page);

      expect(await loggedUpdate(userDataDir, "up to date")).toMatchObject({ trigger: "automatic", target: "0.0.0" });
      expect(await updateButton(page).count()).toBe(0);

      await findAction(page, "Check for Updates");
      const notice = page.getByRole("dialog", { name: "You're up to date" });
      await notice.waitFor();
      await expect.poll(() => notice.textContent()).toContain("0.0.0");
      await captureWindow(page, "01-up-to-date");
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    "givenNewerRelease_whenCheckedAutomatically_thenTheButtonSitsBeforeSettingsAndExplainsADevelopmentRun",
    async () => {
      const { page, userDataDir, local } = await open({ version: "9.0.0" });
      await waitUntilReady(page);

      await updateButton(page).waitFor({ timeout: LAUNCH_TIMEOUT_MS });
      expect(await rightGroupNames(page)).toEqual(["Search Everywhere", "Update", "Settings…"]);
      expect(await updateButton(page).getAttribute("data-phase")).toBe("ineligible");
      expect(await loggedUpdate(userDataDir, "update found; this install cannot update itself")).toMatchObject({
        reason: "unpackaged",
        target: "9.0.0",
      });
      await captureWindow(page, "02-button-before-settings");

      await updateButton(page).click();
      const popover = page.getByTestId("update-popover");
      await popover.waitFor();
      expect(await popover.getByTestId("update-versions").textContent()).toContain("0.0.0 → 9.0.0");
      expect(await popover.getByTestId("update-message").textContent()).toContain("development");
      expect(await popover.getByRole("button", { name: "Download" }).count()).toBe(0);
      expect(local.requests).not.toContain(ASSET_PATH);
      await captureWindow(page, "07-development-run-explains");
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    "givenManifestSignedWithAnotherKey_whenChecked_thenUpdateFailedAndNothingDownloaded",
    async () => {
      const { page, userDataDir, local } = await open({ version: "9.0.0", signedBy: OTHER_KEYS });
      await waitUntilReady(page);

      expect(await loggedUpdate(userDataDir, "update manifest rejected")).toMatchObject({
        level: "error",
        reason: "signature",
      });
      await updateButton(page).waitFor({ timeout: LAUNCH_TIMEOUT_MS });
      expect(await updateButton(page).textContent()).toContain("Update failed");
      await updateButton(page).click();
      await page.getByTestId("update-popover").waitFor();
      expect(local.requests).not.toContain(ASSET_PATH);
      await captureWindow(page, "05-tampered-signature");
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    "givenAutomaticChecksOff_whenLaunched_thenNoRequestUntilCheckedFromHelp",
    async () => {
      const { page, local } = await open({ version: "9.0.0" }, { version: 1, updates: { checkAutomatically: false } });
      await waitUntilReady(page);
      await page.waitForTimeout(FIRST_CHECK_MS * 5);
      expect(local.requests).toEqual([]);

      await findAction(page, "Check for Updates");
      await updateButton(page).waitFor({ timeout: LAUNCH_TIMEOUT_MS });
      expect(local.requests).toContain(MANIFEST_PATH);
    },
    SCENARIO_TIMEOUT_MS,
  );
});
