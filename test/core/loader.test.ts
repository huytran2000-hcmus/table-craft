import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPlugins, type PluginLoadResult } from "@table-craft/core";
import { API_VERSION, MANIFEST_FILE } from "@table-craft/plugin-api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ENTRY_FILE = "index.mjs";
const INCOMPATIBLE_API_VERSION = "0.99.0";
/** Plan 002 broke the contract by adding `cancel` and `PluginError`; plugins built before it must not load. */
const PREVIOUS_API_VERSION = "0.1.0";
const CONNECTION = { fields: [{ key: "path", label: "Path", kind: "text" }] };

function pluginSource(id: string): string {
  return `export default {
  id: ${JSON.stringify(id)},
  capabilities: ["sql"],
  language: {
    split: () => [],
    classify: () => ({ kind: "other", destructive: null }),
    quoteIdentifier: (name) => name,
    literal: () => "NULL",
  },
  connectionSchema: { safeParse: (value) => ({ success: true, data: value }) },
  connect: async () => ({ execute: async () => { throw new Error("not used"); }, close: async () => {} }),
};
`;
}

interface PluginFiles {
  readonly id: string;
  readonly apiVersion?: string;
  readonly source?: string;
}

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "table-craft-loader-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function writePlugin(root: string, directoryName: string, files: PluginFiles): Promise<string> {
  const directory = join(workspace, root, directoryName);
  await mkdir(directory, { recursive: true });
  const manifest = {
    id: files.id,
    name: files.id,
    version: "1.0.0",
    apiVersion: files.apiVersion ?? API_VERSION,
    entry: ENTRY_FILE,
    capabilities: ["sql"],
    highlight: "sql",
    connection: CONNECTION,
  };
  await writeFile(join(directory, MANIFEST_FILE), JSON.stringify(manifest));
  await writeFile(join(directory, ENTRY_FILE), files.source ?? pluginSource(files.id));
  return directory;
}

function byStatus(results: readonly PluginLoadResult[], status: PluginLoadResult["status"]): string[] {
  return results.filter((result) => result.status === status).map((result) => result.manifest?.id ?? "?");
}

describe("loadPlugins", () => {
  it("givenValidPlugin_whenLoaded_thenPluginIsLoaded", async () => {
    await writePlugin("builtin", "alpha", { id: "alpha" });

    const results = await loadPlugins([join(workspace, "builtin")]);

    expect(byStatus(results, "loaded")).toEqual(["alpha"]);
  });

  it("givenManifestWithIncompatibleApiVersion_whenLoaded_thenPluginUnavailableWithReason", async () => {
    await writePlugin("builtin", "alpha", { id: "alpha", apiVersion: INCOMPATIBLE_API_VERSION });

    const [result] = await loadPlugins([join(workspace, "builtin")]);

    expect(result).toMatchObject({ status: "unavailable", manifest: { id: "alpha" } });
    expect(result?.status === "unavailable" && result.reason).toContain(INCOMPATIBLE_API_VERSION);
  });

  it("givenManifestWithApiVersion010_whenLoaded_thenPluginUnavailable", async () => {
    await writePlugin("builtin", "alpha", { id: "alpha", apiVersion: PREVIOUS_API_VERSION });

    const [result] = await loadPlugins([join(workspace, "builtin")]);

    expect(result).toMatchObject({ status: "unavailable", manifest: { id: "alpha" } });
  });

  it("givenDuplicatePluginId_whenLoaded_thenErrorNamesBothPaths", async () => {
    const first = await writePlugin("builtin", "alpha", { id: "alpha" });
    const second = await writePlugin("user", "alpha-copy", { id: "alpha" });

    const results = await loadPlugins([join(workspace, "builtin"), join(workspace, "user")]);

    expect(byStatus(results, "loaded")).toEqual(["alpha"]);
    const duplicate = results.find((result) => result.directory === second);
    expect(duplicate?.status).toBe("unavailable");
    expect(duplicate?.status === "unavailable" && duplicate.reason).toContain(first);
    expect(duplicate?.status === "unavailable" && duplicate.reason).toContain(second);
  });

  it("givenEntryThatThrowsOnImport_whenLoaded_thenOtherPluginsStillLoad", async () => {
    await writePlugin("builtin", "broken", { id: "broken", source: 'throw new Error("boom");\n' });
    await writePlugin("builtin", "working", { id: "working" });

    const results = await loadPlugins([join(workspace, "builtin")]);

    expect(byStatus(results, "loaded")).toEqual(["working"]);
    const broken = results.find((result) => result.manifest?.id === "broken");
    expect(broken?.status === "unavailable" && broken.reason).toContain("boom");
  });

  it("givenSqlPluginWithoutLanguage_whenLoaded_thenUnavailable", async () => {
    const source = pluginSource("mute").replace(/ {2}language: \{[\s\S]*?\n {2}\},\n/, "");
    await writePlugin("builtin", "mute", { id: "mute", source });

    const [result] = await loadPlugins([join(workspace, "builtin")]);

    expect(result?.status === "unavailable" && result.reason).toContain("language");
  });

  it("givenDirectoryWithoutManifest_whenLoaded_thenUnavailableWithReason", async () => {
    await mkdir(join(workspace, "builtin", "stray"), { recursive: true });

    const [result] = await loadPlugins([join(workspace, "builtin")]);

    expect(result?.status === "unavailable" && result.reason).toContain(MANIFEST_FILE);
  });

  it("givenMissingRoot_whenLoaded_thenReturnsNothing", async () => {
    expect(await loadPlugins([join(workspace, "does-not-exist")])).toEqual([]);
  });

  it("givenEntryOutsidePluginDirectory_whenLoaded_thenUnavailable", async () => {
    const directory = await writePlugin("builtin", "escape", { id: "escape" });
    const manifest = { id: "escape", name: "escape", version: "1.0.0", apiVersion: API_VERSION };
    await writeFile(
      join(directory, MANIFEST_FILE),
      JSON.stringify({
        ...manifest,
        entry: "../index.mjs",
        capabilities: ["sql"],
        highlight: "sql",
        connection: CONNECTION,
      }),
    );

    const [result] = await loadPlugins([join(workspace, "builtin")]);

    expect(result?.status === "unavailable" && result.reason).toContain("outside");
  });
});
