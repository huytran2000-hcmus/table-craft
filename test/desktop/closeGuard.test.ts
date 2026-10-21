import { describe, expect, it, vi } from "vitest";
import { createCloseGuard, type GuardedWindow } from "@table-craft/desktop/main/closeGuard.js";
import { CHANNELS } from "@table-craft/desktop/preload/bridge.js";

function fakeWindow(options: { crashed?: boolean } = {}) {
  let listener: ((event: { preventDefault(): void }) => void) | null = null;
  const sent: string[] = [];
  const window = {
    on: (_event: "close", next: (event: { preventDefault(): void }) => void) => {
      listener = next;
    },
    close: vi.fn(() => {
      tryClose();
    }),
    webContents: { send: (channel: string) => sent.push(channel), isCrashed: () => options.crashed === true },
  } satisfies GuardedWindow;
  /** Fires `close` as Electron would; true when nothing prevented it. */
  function tryClose(): boolean {
    let prevented = false;
    listener?.({ preventDefault: () => (prevented = true) });
    return !prevented;
  }
  return { window, sent, tryClose };
}

describe("close guard", () => {
  it("givenGuardedWindow_whenClosed_thenHeldAndRendererAskedOnce", () => {
    const guard = createCloseGuard({ quit: vi.fn() });
    const { window, sent, tryClose } = fakeWindow();
    guard.guard(window);

    expect(tryClose()).toBe(false);
    expect(tryClose()).toBe(false);
    expect(sent).toEqual([CHANNELS.closeRequested]);
  });

  it("givenRendererProceeds_whenClosing_thenWindowCloses", () => {
    const quit = vi.fn();
    const guard = createCloseGuard({ quit });
    const { window, tryClose } = fakeWindow();
    guard.guard(window);
    tryClose();

    guard.answer(window, true);

    expect(window.close).toHaveBeenCalledTimes(1);
    expect(quit).not.toHaveBeenCalled();
  });

  it("givenQuitting_whenRendererProceeds_thenQuitResumes", () => {
    const quit = vi.fn();
    const guard = createCloseGuard({ quit });
    const { window, tryClose } = fakeWindow();
    guard.guard(window);
    guard.beforeQuit();
    tryClose();

    guard.answer(window, true);

    expect(quit).toHaveBeenCalledTimes(1);
    expect(tryClose()).toBe(true);
  });

  it("givenRendererCancels_whenQuitting_thenWindowStaysAndNextCloseAsksAgain", () => {
    const quit = vi.fn();
    const guard = createCloseGuard({ quit });
    const { window, sent, tryClose } = fakeWindow();
    guard.guard(window);
    guard.beforeQuit();
    tryClose();

    guard.answer(window, false);

    expect(quit).not.toHaveBeenCalled();
    expect(window.close).not.toHaveBeenCalled();
    expect(tryClose()).toBe(false);
    expect(sent).toHaveLength(2);
  });

  it("givenCrashedRenderer_whenClosed_thenClosesWithoutAsking", () => {
    const guard = createCloseGuard({ quit: vi.fn() });
    const { window, sent, tryClose } = fakeWindow({ crashed: true });
    guard.guard(window);

    expect(tryClose()).toBe(true);
    expect(sent).toEqual([]);
  });
});
