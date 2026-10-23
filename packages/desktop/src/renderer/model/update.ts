/**
 * What the main toolbar's Update button and its popover show for each `UpdateState` (plan 020,
 * decision 045). Pure, so every phase is pinned by a test without a window.
 */
import type { UpdateState } from "@table-craft/desktop/preload/bridge.js";

export type UpdateButtonTone = "accent" | "neutral" | "danger";

export interface UpdateButtonView {
  readonly label: string;
  readonly tooltip: string;
  readonly tone: UpdateButtonTone;
  /** 0–100 while downloading, else null. */
  readonly percent: number | null;
}

export interface UpdatePopoverView {
  readonly title: string;
  /** `current → new`, or the current version alone when no release is known. */
  readonly versions: string;
  readonly message: string | null;
  readonly size: string | null;
}

const PERCENT = 100;
const KILOBYTE = 1024;
const MEGABYTE = KILOBYTE * KILOBYTE;

export function downloadPercent(received: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(PERCENT, Math.floor((received / total) * PERCENT));
}

export function formatSize(bytes: number): string | null {
  if (bytes <= 0) return null;
  return bytes < MEGABYTE ? `${String(Math.ceil(bytes / KILOBYTE))} KB` : `${(bytes / MEGABYTE).toFixed(1)} MB`;
}

/** The button, or null when there is nothing to offer: idle and checking draw nothing. */
export function updateButton(state: UpdateState): UpdateButtonView | null {
  switch (state.phase) {
    case "idle":
    case "checking":
      return null;
    case "available":
      return {
        label: "Update",
        tooltip: `TableCraft ${state.release.version} is available`,
        tone: "accent",
        percent: null,
      };
    case "downloading": {
      const percent = downloadPercent(state.received, state.total);
      return {
        label: `${String(percent)}%`,
        tooltip: `Downloading TableCraft ${state.release.version}`,
        tone: "neutral",
        percent,
      };
    }
    case "ready":
      return {
        label: "Restart to Update",
        tooltip: `TableCraft ${state.release.version} is ready to install`,
        tone: "accent",
        percent: null,
      };
    case "error":
      return { label: "Update failed", tooltip: state.message, tone: "danger", percent: null };
    case "ineligible":
      return {
        label: "Update",
        tooltip: `TableCraft ${state.release.version} is available`,
        tone: "neutral",
        percent: null,
      };
  }
}

/**
 * The keychain note (plan 020, live test scenario 9): an ad-hoc-signed swap changes the app's code
 * signature, so macOS asks once for the keychain item that holds saved passwords.
 */
/** Measured in plan 020's live test: every ad-hoc build has a new code hash, so macOS asks again. */
export const KEYCHAIN_NOTE =
  "After the restart macOS asks for your login keychain password before TableCraft opens. Enter it and choose Always Allow to keep your saved passwords; Deny leaves them unreadable until you allow it.";

export function updatePopover(state: UpdateState, mac: boolean): UpdatePopoverView {
  const release = state.phase === "idle" || state.phase === "checking" ? null : state.release;
  const versions = release === null ? state.current : `${state.current} → ${release.version}`;
  const size = release === null ? null : formatSize(release.size);
  switch (state.phase) {
    case "idle":
    case "checking":
      return { title: "TableCraft is up to date", versions, message: null, size: null };
    case "available":
      return { title: "A new version of TableCraft is available", versions, message: null, size };
    case "downloading":
      return {
        title: `Downloading… ${String(downloadPercent(state.received, state.total))}%`,
        versions,
        message: null,
        size,
      };
    case "ready":
      return { title: "The update is ready", versions, message: mac ? KEYCHAIN_NOTE : null, size: null };
    case "error":
      return { title: "The update did not work", versions, message: state.message, size: null };
    case "ineligible":
      return { title: "A new version of TableCraft is available", versions, message: state.message, size };
  }
}
