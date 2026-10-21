import { basename } from "node:path";
import { discoverPlugins } from "@table-craft/core";
import type { PluginInfo } from "@table-craft/desktop/preload/bridge.js";

/**
 * Every installed plugin, from manifests alone (decision 019): main never runs plugin code
 * (decision 006). A broken plugin is listed with its reason so the dialog can say why it is
 * greyed out; the engine's loader may still reject an available one when it imports the entry.
 */
export async function listPlugins(roots: readonly string[]): Promise<PluginInfo[]> {
  const found = await discoverPlugins(roots);
  return found.map((entry) => {
    const manifest = entry.manifest;
    return {
      id: manifest?.id ?? basename(entry.directory),
      name: manifest?.name ?? basename(entry.directory),
      unavailableReason: entry.status === "unavailable" ? entry.reason : null,
      capabilities: manifest?.capabilities ?? [],
      fields: manifest?.connection.fields ?? [],
      highlight: manifest?.highlight ?? null,
    };
  });
}
