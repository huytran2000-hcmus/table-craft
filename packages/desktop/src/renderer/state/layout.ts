import { create } from "zustand";

/**
 * Which tool windows are open and how big they are. Per-window UI memory in `localStorage`, not a
 * user preference: `settings.json` (decision 010) is for preferences.
 */
export const LAYOUT_STORAGE_KEY = "table-craft.layout.v1";

export const TOOL_WINDOWS = ["database", "services"] as const;
export type ToolWindowId = (typeof TOOL_WINDOWS)[number];

export interface Layout {
  readonly visible: Readonly<Record<ToolWindowId, boolean>>;
  /** Percent of the window: the Database window's width, the Services window's height. */
  readonly sizes: Readonly<Record<ToolWindowId, number>>;
  /** What `hideAll` closed, so pressing it again brings them back; `null` when nothing is hidden by it. */
  readonly hidden: Readonly<Record<ToolWindowId, boolean>> | null;
  /** Whether the Database pane lists system namespaces such as `pg_catalog` (plan 005). */
  readonly showSystemSchemas: boolean;
}

export const DEFAULT_LAYOUT: Layout = {
  visible: { database: true, services: true },
  sizes: { database: 22, services: 28 },
  hidden: null,
  showSystemSchemas: false,
};

const MIN_SIZE_PERCENT = 5;
const MAX_SIZE_PERCENT = 80;

export type LayoutStorage = Pick<Storage, "getItem" | "setItem">;

function isRecordOf<T>(value: unknown, check: (entry: unknown) => entry is T): value is Record<ToolWindowId, T> {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return TOOL_WINDOWS.every((id) => check(record[id]));
}

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isSize = (value: unknown): value is number =>
  typeof value === "number" && value >= MIN_SIZE_PERCENT && value <= MAX_SIZE_PERCENT;

/** The saved layout, or the default when there is none or it no longer reads as one. */
export function loadLayout(storage: Pick<Storage, "getItem">): Layout {
  const text = storage.getItem(LAYOUT_STORAGE_KEY);
  if (text === null) return DEFAULT_LAYOUT;
  let saved: unknown;
  try {
    saved = JSON.parse(text);
  } catch {
    return DEFAULT_LAYOUT;
  }
  if (typeof saved !== "object" || saved === null) return DEFAULT_LAYOUT;
  const { visible, sizes, hidden, showSystemSchemas } = saved as Record<string, unknown>;
  if (!isRecordOf(visible, isBoolean) || !isRecordOf(sizes, isSize)) return DEFAULT_LAYOUT;
  return {
    visible,
    sizes,
    hidden: isRecordOf(hidden, isBoolean) ? hidden : null,
    showSystemSchemas: showSystemSchemas === true,
  };
}

export function saveLayout(storage: Pick<Storage, "setItem">, layout: Layout): void {
  storage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
}

export function toggled(layout: Layout, id: ToolWindowId): Layout {
  return { ...layout, visible: { ...layout.visible, [id]: !layout.visible[id] }, hidden: null };
}

/** DataGrip's Hide All Tool Windows: hides what is open, or restores what it last hid. */
export function hiddenAll(layout: Layout): Layout {
  const anyVisible = TOOL_WINDOWS.some((id) => layout.visible[id]);
  if (anyVisible) return { ...layout, visible: { database: false, services: false }, hidden: layout.visible };
  if (layout.hidden !== null) return { ...layout, visible: layout.hidden, hidden: null };
  return layout;
}

export function resized(layout: Layout, id: ToolWindowId, percent: number): Layout {
  const size = Math.min(MAX_SIZE_PERCENT, Math.max(MIN_SIZE_PERCENT, percent));
  if (layout.sizes[id] === size) return layout;
  return { ...layout, sizes: { ...layout.sizes, [id]: size } };
}

export interface LayoutState {
  readonly layout: Layout;
  readonly toggle: (id: ToolWindowId) => void;
  readonly hideAll: () => void;
  readonly resize: (id: ToolWindowId, percent: number) => void;
  readonly toggleSystemSchemas: () => void;
}

/** A layout store over `storage`; the app passes `localStorage`, tests a map. */
export function createLayoutStore(storage: LayoutStorage) {
  return create<LayoutState>()((set, get) => {
    function update(next: Layout): void {
      if (next === get().layout) return;
      set({ layout: next });
      saveLayout(storage, next);
    }
    return {
      layout: loadLayout(storage),
      toggle: (id) => update(toggled(get().layout, id)),
      hideAll: () => update(hiddenAll(get().layout)),
      resize: (id, percent) => update(resized(get().layout, id, percent)),
      toggleSystemSchemas: () => update({ ...get().layout, showSystemSchemas: !get().layout.showSystemSchemas }),
    };
  });
}

export type LayoutStore = ReturnType<typeof createLayoutStore>;

/** For a renderer without `localStorage`, such as a unit test importing the app's stores. */
export function memoryStorage(): LayoutStorage {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
  };
}

export const useLayout = createLayoutStore(
  typeof globalThis.localStorage === "undefined" ? memoryStorage() : globalThis.localStorage,
);
