import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  API_VERSION,
  isCompatible,
  MANIFEST_FILE,
  pluginManifestSchema,
  type DatasourcePlugin,
  type PluginManifest,
} from "@table-craft/plugin-api";

export interface LoadedPlugin {
  readonly status: "loaded";
  readonly directory: string;
  readonly manifest: PluginManifest;
  readonly plugin: DatasourcePlugin;
}

export interface UnavailablePlugin {
  readonly status: "unavailable";
  readonly directory: string;
  /** Present when the manifest was valid, so the UI can still name the plugin. */
  readonly manifest: PluginManifest | null;
  readonly reason: string;
}

export type PluginLoadResult = LoadedPlugin | UnavailablePlugin;

const MISSING_FILE = "ENOENT";

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === MISSING_FILE;
}

async function pluginDirectories(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name))
      .sort();
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

type ManifestRead = { ok: true; manifest: PluginManifest } | { ok: false; reason: string };

async function readManifest(directory: string): Promise<ManifestRead> {
  let text: string;
  try {
    text = await readFile(join(directory, MANIFEST_FILE), "utf8");
  } catch (error) {
    if (isMissing(error)) return { ok: false, reason: `No ${MANIFEST_FILE}; add one or remove the directory.` };
    return { ok: false, reason: `Cannot read ${MANIFEST_FILE}: ${describe(error)}` };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { ok: false, reason: `${MANIFEST_FILE} is not valid JSON: ${describe(error)}` };
  }
  const parsed = pluginManifestSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    return { ok: false, reason: `${MANIFEST_FILE} is invalid: ${issues.join("; ")}` };
  }
  return { ok: true, manifest: parsed.data };
}

function isDatasourcePlugin(value: unknown): value is DatasourcePlugin {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const schema = candidate["connectionSchema"] as { safeParse?: unknown } | undefined;
  return (
    typeof candidate["id"] === "string" &&
    Array.isArray(candidate["capabilities"]) &&
    typeof candidate["connect"] === "function" &&
    typeof schema?.safeParse === "function"
  );
}

function sameCapabilities(manifest: PluginManifest, plugin: DatasourcePlugin): boolean {
  const declared = new Set<string>(manifest.capabilities);
  return declared.size === plugin.capabilities.length && plugin.capabilities.every((name) => declared.has(name));
}

async function importPlugin(directory: string, manifest: PluginManifest): Promise<PluginLoadResult> {
  const unavailable = (reason: string): UnavailablePlugin => ({ status: "unavailable", directory, manifest, reason });
  const entry = resolve(directory, manifest.entry);
  const fromDirectory = relative(directory, entry);
  if (fromDirectory.startsWith("..") || isAbsolute(fromDirectory)) {
    return unavailable(`entry "${manifest.entry}" points outside the plugin directory.`);
  }
  let module: { default?: unknown };
  try {
    module = (await import(/* @vite-ignore */ pathToFileURL(entry).href)) as { default?: unknown };
  } catch (error) {
    return unavailable(`entry "${manifest.entry}" failed to load: ${describe(error)}`);
  }
  const plugin = module.default;
  if (!isDatasourcePlugin(plugin)) {
    return unavailable(`entry "${manifest.entry}" has no default export implementing DatasourcePlugin.`);
  }
  if (plugin.id !== manifest.id) {
    return unavailable(`entry exports plugin "${plugin.id}" but the manifest declares "${manifest.id}".`);
  }
  if (!sameCapabilities(manifest, plugin)) {
    return unavailable("capabilities in the manifest and the entry's export differ; make them match.");
  }
  return { status: "loaded", directory, manifest, plugin };
}

/**
 * Loads every plugin directory under `roots`, in order (decision 005). Earlier roots win an id
 * clash, so pass the built-in root first. A broken plugin becomes an `UnavailablePlugin` with a
 * reason; it never stops the others.
 */
export async function loadPlugins(roots: readonly string[]): Promise<PluginLoadResult[]> {
  const results: PluginLoadResult[] = [];
  const claimed = new Map<string, string>();
  for (const root of roots) {
    for (const directory of await pluginDirectories(root)) {
      const read = await readManifest(directory);
      if (!read.ok) {
        results.push({ status: "unavailable", directory, manifest: null, reason: read.reason });
        continue;
      }
      const { manifest } = read;
      const owner = claimed.get(manifest.id);
      if (owner !== undefined) {
        const reason = `Duplicate plugin id "${manifest.id}": ${directory} conflicts with ${owner}, which loaded first. Remove one.`;
        results.push({ status: "unavailable", directory, manifest, reason });
        continue;
      }
      claimed.set(manifest.id, directory);
      if (!isCompatible(manifest.apiVersion)) {
        const reason = `Built for plugin API ${manifest.apiVersion}, but this table-craft provides ${API_VERSION}. Install a compatible version of the plugin.`;
        results.push({ status: "unavailable", directory, manifest, reason });
        continue;
      }
      results.push(await importPlugin(directory, manifest));
    }
  }
  return results;
}
