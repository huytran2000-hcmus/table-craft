import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "@table-craft/plugin-api";
import { writeAtomically, type FileSystem } from "@table-craft/desktop/main/files.js";
import type { ThemeFolder } from "@table-craft/desktop/main/themes.js";
import type { SettingsChanged, SettingsSnapshot } from "@table-craft/desktop/preload/bridge.js";
import { readSettings, SETTINGS_VERSION, type Settings } from "@table-craft/desktop/settings/settings.js";

export const SETTINGS_FILE = "settings.json";
const BACKUP_SUFFIX = ".corrupt-";
const JSON_INDENT = 2;

/**
 * Only the envelope must hold for the file to be read; each preference inside it falls back to its
 * default on its own (`readSettings`), so one bad number does not cost the others (decision 032).
 */
const envelopeSchema = z.looseObject({ version: z.literal(SETTINGS_VERSION) });

/** The whole document as the renderer sends it on `settings.write`: strict, every field in range. */
export const settingsSchema: z.ZodType<Settings> = z.custom<Settings>(
  (value) => isDeepStrictEqual(readSettings(value), value),
  { message: "Settings must be a complete version 1 document with every value in range." },
);

export interface LoadedSettings {
  readonly settings: Settings;
  /** Why the file was set aside, for the one-time notice; null when it read cleanly. */
  readonly warning: string | null;
}

export interface SettingsStore {
  load(): Promise<LoadedSettings>;
  save(settings: Settings): Promise<void>;
}

export interface SettingsStoreOptions {
  readonly directory: string;
  readonly files: FileSystem;
  readonly now?: () => number;
}

/**
 * Each older version's upgrade to the next, keyed by the version it reads. Empty while version 1
 * is the only one; a file from a newer table-craft fails the envelope and is set aside.
 */
const MIGRATIONS: ReadonlyMap<number, (file: Record<string, unknown>) => Record<string, unknown>> = new Map();

function migrate(json: unknown): unknown {
  let file = json as Record<string, unknown> | null;
  while (typeof file?.version === "number" && MIGRATIONS.has(file.version)) {
    file = MIGRATIONS.get(file.version)?.(file) ?? file;
  }
  return file;
}

export interface SettingsServiceOptions {
  readonly store: SettingsStore;
  readonly themes: ThemeFolder;
  /** After a save or a reread: broadcast to every window and restyle the native side. */
  readonly onChanged: (changed: SettingsChanged) => void;
}

/** Main's copy of the settings and the user themes, read once at launch and kept current. */
export interface SettingsService {
  snapshot(): SettingsSnapshot;
  write(settings: Settings): Promise<void>;
  reloadThemes(): Promise<void>;
}

export async function createSettingsService(options: SettingsServiceOptions): Promise<SettingsService> {
  const loaded = await options.store.load();
  let settings = loaded.settings;
  let themes = await options.themes.list();
  /** Saves run one at a time: two at once would share the temporary file and could land out of order. */
  let saving: Promise<void> = Promise.resolve();
  return {
    snapshot: () => ({ settings, themes, warning: loaded.warning }),
    write(next) {
      const saved = saving.then(async () => {
        await options.store.save(next);
        settings = next;
        options.onChanged({ settings, themes });
      });
      saving = saved.catch(() => undefined);
      return saved;
    },
    async reloadThemes() {
      themes = await options.themes.list();
      options.onChanged({ settings, themes });
    },
  };
}

export function createSettingsStore(options: SettingsStoreOptions): SettingsStore {
  const path = join(options.directory, SETTINGS_FILE);
  const now = options.now ?? Date.now;

  async function setAside(reason: string): Promise<LoadedSettings> {
    const backup = `${path}${BACKUP_SUFFIX}${String(now())}`;
    await options.files.rename(path, backup);
    return {
      settings: readSettings(undefined),
      warning: `${SETTINGS_FILE} could not be read (${reason}). It was moved to ${backup}, and every setting is back to its default.`,
    };
  }

  return {
    async load() {
      const text = await options.files.readText(path);
      if (text === null) return { settings: readSettings(undefined), warning: null };
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (cause) {
        return setAside(`not JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
      const migrated = migrate(json);
      const parsed = envelopeSchema.safeParse(migrated);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
        return setAside(issues.join("; "));
      }
      return { settings: readSettings(migrated), warning: null };
    },
    async save(settings) {
      await writeAtomically(options.files, path, `${JSON.stringify(settings, null, JSON_INDENT)}\n`);
    },
  };
}
