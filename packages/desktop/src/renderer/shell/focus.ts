import { REGION_ATTRIBUTE, type FocusRegion } from "@table-craft/desktop/renderer/actions/context.js";

/** Marks the control a region focuses first, e.g. the console's editor. */
export const AUTOFOCUS_ATTRIBUTE = "data-region-focus";

const FOCUSABLE = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

/** Moves focus into a region: its marked control, else its first focusable, else the region itself. */
export function focusRegion(region: Exclude<FocusRegion, "other">): void {
  const container = document.querySelector<HTMLElement>(`[${REGION_ATTRIBUTE}="${region}"]`);
  if (container === null) return;
  const target =
    container.querySelector<HTMLElement>(`[${AUTOFOCUS_ATTRIBUTE}]`) ??
    container.querySelector<HTMLElement>(FOCUSABLE) ??
    container;
  target.focus();
}
