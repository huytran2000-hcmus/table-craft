/**
 * What the updater keeps in the profile: the skipped version in `update-state.json`, owned by main
 * alone so it never races the Settings dialog's writes to `settings.json`, and the swap script's
 * output, which the next launch moves into the app log.
 */
import { isVersion } from "@table-craft/desktop/main/update/manifest.js";
import type { UpdateMemory } from "@table-craft/desktop/main/update/updater.js";
import type { Logger } from "@table-craft/desktop/log/record.js";

export const UPDATE_STATE_FILE = "update-state.json";
export const SWAP_LOG_FILE = "update-swap.log";
/** The script's own words for a swap that did not happen; such a line is a warning, not news. */
const SWAP_FAILURE = /nothing was replaced|was restored/;

export interface MemoryFiles {
  readText(path: string): Promise<string | null>;
  writeText(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export function readUpdateMemory(text: string | null): UpdateMemory {
  if (text === null) return { skippedVersion: null };
  try {
    const parsed = JSON.parse(text) as { skippedVersion?: unknown };
    return { skippedVersion: isVersion(parsed.skippedVersion) ? parsed.skippedVersion : null };
  } catch {
    return { skippedVersion: null };
  }
}

export function writeUpdateMemory(memory: UpdateMemory): string {
  return `${JSON.stringify(memory, null, 2)}\n`;
}

/** Appends the last swap's lines to the log and removes the file, so each is logged once. */
export async function drainSwapLog(path: string, files: MemoryFiles, log: Logger): Promise<void> {
  const text = await files.readText(path);
  if (text === null) return;
  for (const line of text.split("\n").filter((entry) => entry.trim() !== "")) {
    if (SWAP_FAILURE.test(line)) log.warn("swap script", { line });
    else log.info("swap script", { line });
  }
  await files.remove(path);
}
