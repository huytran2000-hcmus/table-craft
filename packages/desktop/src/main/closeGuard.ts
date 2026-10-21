import { CHANNELS } from "@table-craft/desktop/preload/bridge.js";

/** The slice of `BrowserWindow` the guard needs. */
export interface GuardedWindow {
  on(event: "close", listener: (event: { preventDefault(): void }) => void): void;
  close(): void;
  readonly webContents: { send(channel: string): void; isCrashed(): boolean };
}

export interface CloseGuard<W extends GuardedWindow> {
  /** Holds every close of `window` until its renderer answers. */
  readonly guard: (window: W) => void;
  /** `app.on("before-quit")`: a close the renderer then allows finishes the quit. */
  readonly beforeQuit: () => void;
  /** The renderer's answer: proceed closes the window (and quits, when quitting); otherwise both stop. */
  readonly answer: (window: W, proceed: boolean) => void;
}

/**
 * A window closes only after its renderer has said so (decision 024): it commits or rolls back open
 * transactions and flushes unsaved consoles first. `beforeunload` cannot do this, because the
 * renderer's answer is asynchronous and a refused unload aborts the quit.
 */
export function createCloseGuard<W extends GuardedWindow>(options: { readonly quit: () => void }): CloseGuard<W> {
  const released = new WeakSet<W>();
  const asking = new WeakSet<W>();
  let quitting = false;

  return {
    guard(window) {
      window.on("close", (event) => {
        if (released.has(window) || window.webContents.isCrashed()) return;
        event.preventDefault();
        if (asking.has(window)) return;
        asking.add(window);
        window.webContents.send(CHANNELS.closeRequested);
      });
    },
    beforeQuit() {
      quitting = true;
    },
    answer(window, proceed) {
      asking.delete(window);
      if (!proceed) {
        quitting = false;
        return;
      }
      released.add(window);
      if (quitting) options.quit();
      else window.close();
    },
  };
}
