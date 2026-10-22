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
export const CONNECTION_FIELD_KINDS = ["text", "number", "password", "file", "select", "checkbox"] as const;

export type ConnectionFieldKind = (typeof CONNECTION_FIELD_KINDS)[number];

export const CONNECTION_FIELD_GROUPS = ["general", "advanced"] as const;

export type ConnectionFieldGroup = (typeof CONNECTION_FIELD_GROUPS)[number];

const FIELD_KEY = /^[a-zA-Z][a-zA-Z0-9]*$/;

/**
 * One control of the connection form (decision 019). `key` names the config property it fills;
 * `secret` sends the value to the secret store instead of `datasources.json` (decision 020).
 */
export const connectionFieldSchema = z.strictObject({
  key: z.string().regex(FIELD_KEY, { message: "expected a camelCase config key" }),
  label: z.string().min(1),
  kind: z.enum(CONNECTION_FIELD_KINDS),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
  /** The choices of a `select`, in display order. */
  options: z
    .array(z.strictObject({ value: z.string(), label: z.string().min(1) }))
    .min(1)
    .optional(),
  group: z.enum(CONNECTION_FIELD_GROUPS).optional(),
  secret: z.boolean().optional(),
});

export type ConnectionField = z.infer<typeof connectionFieldSchema>;

export const pluginManifestSchema = z
  .strictObject({
    id: z.string().regex(PLUGIN_ID, { message: "expected lower-case letters, digits and dashes" }),
    name: z.string().min(1),
    version: semver,
    apiVersion: semver,
    /** An ES module, relative to the manifest, whose default export is the `DatasourcePlugin`. */
    entry: z.string().min(1),
    capabilities: z.array(z.enum(CAPABILITIES)),
    /** The highlighter the console uses for this plugin's dialect (decision 008). */
    highlight: z.string().min(1),
    /** The connection form, readable without running plugin code (decision 019). */
    connection: z.strictObject({ fields: z.array(connectionFieldSchema).min(1) }),
  })
  // A definition is read through the introspector, which only `schemaTree` promises (decision 029).
  .refine((manifest) => !manifest.capabilities.includes("ddl") || manifest.capabilities.includes("schemaTree"), {
    message: "the ddl capability requires schemaTree",
    path: ["capabilities"],
  });

export type PluginManifest = z.infer<typeof pluginManifestSchema>;
