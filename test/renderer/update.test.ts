import { afterEach, describe, expect, it } from "vitest";
import type { UpdateState } from "@table-craft/desktop/preload/bridge.js";
import { createActionRegistry } from "@table-craft/desktop/renderer/actions/registry.js";
import { UPDATE_ACTION_IDS, UPDATE_ACTIONS } from "@table-craft/desktop/renderer/actions/updateActions.js";
import {
  downloadPercent,
  formatSize,
  KEYCHAIN_NOTE,
  updateButton,
  updatePopover,
} from "@table-craft/desktop/renderer/model/update.js";
import { useUpdate } from "@table-craft/desktop/renderer/state/update.js";
import { IDLE_CONTEXT } from "./support.js";

const CURRENT = "0.1.0";
const RELEASE = { version: "0.2.0", size: 150 * 1024 * 1024 };

const STATES: Readonly<Record<UpdateState["phase"], UpdateState>> = {
  idle: { phase: "idle", current: CURRENT },
  checking: { phase: "checking", current: CURRENT },
  available: { phase: "available", current: CURRENT, release: RELEASE },
  downloading: { phase: "downloading", current: CURRENT, release: RELEASE, received: 50, total: 200 },
  ready: { phase: "ready", current: CURRENT, release: RELEASE },
  error: {
    phase: "error",
    current: CURRENT,
    release: RELEASE,
    message: "The download was interrupted.",
    retryable: true,
  },
  ineligible: { phase: "ineligible", current: CURRENT, release: RELEASE, message: "Move TableCraft to Applications." },
};

function registryIn(state: UpdateState) {
  useUpdate.getState().changed(state);
  const registry = createActionRegistry(() => IDLE_CONTEXT);
  registry.register(UPDATE_ACTIONS);
  return registry;
}

function availableIds(state: UpdateState): string[] {
  const registry = registryIn(state);
  return Object.values(UPDATE_ACTION_IDS).filter((id) => registry.isAvailable(id));
}

afterEach(() => {
  useUpdate.setState({ state: STATES.idle, open: false });
});

describe("update button", () => {
  it("givenNothingToOffer_whenDrawn_thenNoButton", () => {
    expect(updateButton(STATES.idle)).toBeNull();
    expect(updateButton(STATES.checking)).toBeNull();
  });

  it("givenEachOfferingPhase_whenDrawn_thenLabelAndTone", () => {
    const drawn = (["available", "downloading", "ready", "error", "ineligible"] as const).map((phase) => {
      const view = updateButton(STATES[phase]);
      return [phase, view?.label, view?.tone];
    });

    expect(drawn).toEqual([
      ["available", "Update", "accent"],
      ["downloading", "25%", "neutral"],
      ["ready", "Restart to Update", "accent"],
      ["error", "Update failed", "danger"],
      ["ineligible", "Update", "neutral"],
    ]);
  });

  it("givenProgress_whenPercentComputed_thenFlooredAndClamped", () => {
    expect(downloadPercent(0, 0)).toBe(0);
    expect(downloadPercent(199, 200)).toBe(99);
    expect(downloadPercent(300, 200)).toBe(100);
  });

  it("givenSizes_whenFormatted_thenKilobytesBelowAMegabyte", () => {
    expect([0, 54, 2048, 150 * 1024 * 1024].map(formatSize)).toEqual([null, "1 KB", "2 KB", "150.0 MB"]);
  });
});

describe("update popover", () => {
  it("givenAvailable_whenShown_thenCurrentToNewAndSize", () => {
    expect(updatePopover(STATES.available, true)).toEqual({
      title: "A new version of TableCraft is available",
      versions: "0.1.0 → 0.2.0",
      message: null,
      size: "150.0 MB",
    });
  });

  it("givenReadyOnMac_whenShown_thenTheKeychainNoteIsThere", () => {
    expect(updatePopover(STATES.ready, true).message).toBe(KEYCHAIN_NOTE);
    expect(updatePopover(STATES.ready, false).message).toBeNull();
  });

  it("givenErrorOrIneligible_whenShown_thenMainsMessage", () => {
    expect(updatePopover(STATES.error, true).message).toBe("The download was interrupted.");
    expect(updatePopover(STATES.ineligible, true).message).toBe("Move TableCraft to Applications.");
  });
});

describe("update actions", () => {
  it.each([
    ["idle", ["update.check"]],
    ["available", ["update.check", "update.show", "update.download", "update.skip", "update.later", "update.notes"]],
    ["downloading", ["update.check", "update.show", "update.cancel", "update.later", "update.notes"]],
    ["ready", ["update.check", "update.show", "update.install", "update.skip", "update.later", "update.notes"]],
    ["error", ["update.check", "update.show", "update.retry", "update.dismiss", "update.notes"]],
    ["ineligible", ["update.check", "update.show", "update.skip", "update.dismiss", "update.notes"]],
  ] as const)("givenPhase %s_whenListed_thenOnlyItsActionsAreAvailable", (phase, ids) => {
    expect(availableIds(STATES[phase])).toEqual(ids);
  });

  it("givenErrorThatRetryCannotFix_whenListed_thenNoRetry", () => {
    expect(availableIds({ ...STATES.error, retryable: false } as UpdateState)).not.toContain("update.retry");
  });

  it("givenCheckInFlight_whenCheckAsked_thenItIsDisabled", () => {
    expect(registryIn(STATES.checking).isEnabled(UPDATE_ACTION_IDS.check)).toBe(false);
  });

  it("givenOpenPopover_whenTheStateFallsBackToIdle_thenItCloses", () => {
    useUpdate.getState().changed(STATES.available);
    useUpdate.getState().setOpen(true);

    useUpdate.getState().changed(STATES.idle);

    expect(useUpdate.getState().open).toBe(false);
  });
});
