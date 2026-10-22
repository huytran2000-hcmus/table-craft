import { create } from "zustand";
import {
  DENSITIES,
  resolveTheme,
  type ResolvedTheme,
  type SystemAppearance,
  type UserThemeEntry,
} from "@table-craft/desktop/appearance/themes.js";
import type { ResultPaging } from "@table-craft/desktop/engine/protocol.js";
import type {
  InvokeResult,
  SettingsChanged,
  SettingsSnapshot,
  TableCraftBridge,
} from "@table-craft/desktop/preload/bridge.js";
import { bridge } from "@table-craft/desktop/renderer/bridge.js";
import type { CellFormats } from "@table-craft/desktop/renderer/grid/format.js";
import { DEFAULT_SETTINGS, type Settings } from "@table-craft/desktop/settings/settings.js";

type SettingsBridge = Pick<TableCraftBridge, "readSettings" | "writeSettings" | "reloadThemes" | "openThemesFolder">;

export interface SettingsState {
  readonly settings: Settings;
  readonly themes: readonly UserThemeEntry[];
  /** What `prefers-color-scheme` and `prefers-contrast` say; a `"system"` theme follows it. */
  readonly system: SystemAppearance;
  /** Why `settings.json` was set aside, or why a save failed; shown once, until dismissed. */
  readonly notice: string | null;
  /** Reads main's copy; `main.tsx` awaits it before the first render (plan 013 decision 5). */
  readonly load: () => Promise<void>;
  /** Main saved settings or reread the themes, in this window or another. */
  readonly changed: (changed: SettingsChanged) => void;
  readonly setSystem: (system: SystemAppearance) => void;
  /**
   * The one way settings change: applied here at once, then saved through main. A save that fails
   * puts the previous settings back and says why.
   */
  readonly update: (patch: (current: Settings) => Settings) => Promise<void>;
  readonly reloadThemes: () => Promise<void>;
  readonly openThemesFolder: () => Promise<void>;
  readonly dismissNotice: () => void;
}

export interface SettingsStoreOptions {
  readonly bridge: () => SettingsBridge;
  readonly log: (message: string, cause: unknown) => void;
}

const DARK_SYSTEM: SystemAppearance = { prefersDark: true, prefersMoreContrast: false };

function failureText(answer: InvokeResult<unknown>): string | null {
  return answer.ok ? null : `${answer.error.message} ${answer.error.hint}`;
}

export function createSettingsStore(options: SettingsStoreOptions) {
  return create<SettingsState>()((set, get) => {
    /** Writes not yet answered; an echo of an older one must not undo a newer local change. */
    let pendingWrites = 0;

    async function call(run: () => Promise<InvokeResult<unknown>>, what: string): Promise<boolean> {
      try {
        const failure = failureText(await run());
        if (failure === null) return true;
        set({ notice: `Could not ${what}: ${failure}` });
      } catch (cause) {
        options.log(`could not ${what}`, cause);
        set({ notice: `Could not ${what}. Restart table-craft and try again.` });
      }
      return false;
    }

    return {
      settings: DEFAULT_SETTINGS,
      themes: [],
      system: DARK_SYSTEM,
      notice: null,
      async load() {
        let snapshot: SettingsSnapshot | null = null;
        await call(async () => {
          const answer = await options.bridge().readSettings();
          if (answer.ok) snapshot = answer.value;
          return answer;
        }, "read the settings");
        if (snapshot === null) return;
        const { settings, themes, warning } = snapshot;
        set({ settings, themes, notice: warning ?? get().notice });
      },
      changed({ settings, themes }) {
        set(pendingWrites > 0 ? { themes } : { settings, themes });
      },
      setSystem(system) {
        const current = get().system;
        if (current.prefersDark === system.prefersDark && current.prefersMoreContrast === system.prefersMoreContrast) {
          return;
        }
        set({ system });
      },
      async update(patch) {
        const previous = get().settings;
        const next = patch(previous);
        if (next === previous) return;
        set({ settings: next });
        pendingWrites += 1;
        const saved = await call(() => options.bridge().writeSettings(next), "save the settings");
        pendingWrites -= 1;
        if (!saved && get().settings === next) set({ settings: previous });
      },
      async reloadThemes() {
        await call(() => options.bridge().reloadThemes(), "reload the themes");
      },
      async openThemesFolder() {
        await call(() => options.bridge().openThemesFolder(), "open the themes folder");
      },
      dismissNotice: () => set({ notice: null }),
    };
  });
}

export type SettingsStore = ReturnType<typeof createSettingsStore>;

export const useSettings = createSettingsStore({
  bridge,
  log: (message, cause) => console.error(`table-craft: ${message}`, cause),
});

/** The theme the settings choose, made concrete for the system appearance and the user themes. */
export function themeOf(state: Pick<SettingsState, "settings" | "system" | "themes">): ResolvedTheme {
  return resolveTheme(state.settings.appearance.theme, state.system, state.themes);
}

/**
 * The row height the density draws; virtualised lists read it here rather than once at import,
 * so their row positions and the DOM's `--tc-row-height` agree after a density change.
 */
export function useRowHeightPx(): number {
  return useSettings((state) => DENSITIES[state.settings.appearance.density].rowHeightPx);
}

/** How the grid draws and measures cells; the same object until a Data Editor setting changes. */
export function useCellFormats(): CellFormats {
  return useSettings((state) => state.settings.data);
}

export function currentFormats(): CellFormats {
  return useSettings.getState().settings.data;
}

/** What every call that reads rows carries (decision 032). */
export function pagingOf(settings: Settings): ResultPaging {
  return { pageRows: settings.data.pageRows, fetchAllCap: settings.data.fetchAllCap };
}

/** The paging to send now; a change applies to the next statement, not to open results. */
export function currentPaging(): ResultPaging {
  return pagingOf(useSettings.getState().settings);
}
