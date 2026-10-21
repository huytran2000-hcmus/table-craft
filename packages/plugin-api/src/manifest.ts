import { z } from "zod";
import { CAPABILITIES } from "./plugin.js";
import { parseVersion } from "./version.js";

/** The file that marks a directory as a plugin (decision 005). */
export const MANIFEST_FILE = "table-craft-plugin.json";

const PLUGIN_ID = /^[a-z][a-z0-9-]*$/;

const semver = z.string().refine((text) => parseVersion(text) !== null, { message: "expected major.minor.patch" });

/**
 * What the loader reads before executing any plugin code, so an unavailable plugin can still be
 * named in the UI.
 */
export const pluginManifestSchema = z.strictObject({
  id: z.string().regex(PLUGIN_ID, { message: "expected lower-case letters, digits and dashes" }),
  name: z.string().min(1),
  version: semver,
  apiVersion: semver,
  /** An ES module, relative to the manifest, whose default export is the `DatasourcePlugin`. */
  entry: z.string().min(1),
  capabilities: z.array(z.enum(CAPABILITIES)),
  /** The highlighter the console uses for this plugin's dialect (decision 008). */
  highlight: z.string().min(1),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;
