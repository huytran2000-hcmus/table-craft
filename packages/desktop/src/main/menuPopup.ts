import type { BrowserWindow, Point, PopupOptions } from "electron";
import type { DensityTokens } from "@table-craft/desktop/appearance/themes.js";

const ALT = "Alt";

/** The slice of `Menu` a popup needs. */
export interface PopupMenu {
  popup(options: PopupOptions): void;
}

/** Where the main-menu button's menu opens: its bottom-left, under the toolbar at the left edge. */
export function menuButtonAnchor(density: DensityTokens): Point {
  return { x: 0, y: density.titleBarHeightPx };
}

/** Pops the application menu in `window` at `point`, in the window's content coordinates. */
export function popupApplicationMenu(menu: PopupMenu | null, window: BrowserWindow, point: Point): void {
  menu?.popup({ window, x: point.x, y: point.y });
}

export interface KeyInput {
  readonly type: "keyDown" | "keyUp";
  readonly key: string;
}

export interface LoneAlt {
  /** Feed every `before-input-event`; true on the keyUp that completes Alt pressed and released alone. */
  input(event: KeyInput): boolean;
  /** The window lost focus, so keyUps for the keys held now will never arrive. */
  reset(): void;
}

/**
 * Windows' and Linux's "Alt opens the menu" without a menu bar (decision 034). Any other key between
 * Alt's press and release disarms it, so Alt chords and AltGr typing (which Chromium reports as
 * Control then Alt, or as `AltGraph`) never open the menu.
 */
export function createLoneAlt(): LoneAlt {
  const held = new Set<string>();
  let armed = false;
  return {
    input({ type, key }) {
      if (type === "keyDown") {
        // A repeated Alt keyDown while armed keeps it armed; Alt pressed over another key never arms.
        if (key !== ALT) armed = false;
        else if (!held.has(ALT)) armed = held.size === 0;
        held.add(key);
        return false;
      }
      held.delete(key);
      if (key !== ALT) return false;
      const complete = armed && held.size === 0;
      armed = false;
      return complete;
    },
    reset() {
      held.clear();
      armed = false;
    },
  };
}
