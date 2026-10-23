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

/** `server`: `scheme://user:password@host:port/database?params`; `file`: a path, bare or as a URL. */
export const CONNECTION_URL_FORMS = ["server", "file"] as const;

export type ConnectionUrlForm = (typeof CONNECTION_URL_FORMS)[number];

/** The pieces of a connection URL a field can take; `path` belongs to the `file` form. */
export const CONNECTION_URL_PARTS = ["host", "port", "database", "user", "password", "path"] as const;

export type ConnectionUrlPart = (typeof CONNECTION_URL_PARTS)[number];

const URL_SCHEME = /^[a-z][a-z0-9+.-]*$/;

/**
 * How a connection URL maps onto the form's fields (decision 055), so the host parses and writes
 * one without running plugin code. `parts` names the field each piece of the URL fills; a query
 * parameter fills `key`, its value translated through `values` (compared case-insensitively) when
 * given, so a value outside them is reported as ignored.
 */
export const connectionUrlSchema = z.strictObject({
  /** Without `://`; the first is the one the host writes. */
  schemes: z.array(z.string().regex(URL_SCHEME, { message: "expected a lower-case URL scheme" })).min(1),
  form: z.enum(CONNECTION_URL_FORMS),
  parts: z.partialRecord(z.enum(CONNECTION_URL_PARTS), z.string().regex(FIELD_KEY)),
  params: z
    .array(
      z.strictObject({
        name: z.string().min(1),
        key: z.string().regex(FIELD_KEY),
        values: z.record(z.string(), z.string()).optional(),
      }),
    )
    .optional(),
});

export type ConnectionUrl = z.infer<typeof connectionUrlSchema>;

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
    connection: z.strictObject({
      fields: z.array(connectionFieldSchema).min(1),
      /** Absent: the form offers no URL to paste and the data source no Copy as URL. */
      url: connectionUrlSchema.optional(),
    }),
  })
  // A definition is read through the introspector, which only `schemaTree` promises (decision 029).
  .refine((manifest) => !manifest.capabilities.includes("ddl") || manifest.capabilities.includes("schemaTree"), {
    message: "the ddl capability requires schemaTree",
    path: ["capabilities"],
  })
  // A plan is of a statement, and Analyse is Explain that also runs it (decision 031).
  .refine((manifest) => !manifest.capabilities.includes("explain") || manifest.capabilities.includes("sql"), {
    message: "the explain capability requires sql",
    path: ["capabilities"],
  })
  .refine(
    (manifest) => !manifest.capabilities.includes("explainAnalyze") || manifest.capabilities.includes("explain"),
    { message: "the explainAnalyze capability requires explain", path: ["capabilities"] },
  )
  // A namespace is switched by a statement, and the switch is told apart by the language (decision 048).
  .refine((manifest) => !manifest.capabilities.includes("currentNamespace") || manifest.capabilities.includes("sql"), {
    message: "the currentNamespace capability requires sql",
    path: ["capabilities"],
  })
  // An import commits at boundaries it chooses and rolls back the rest (decision 046).
  .refine(
    (manifest) => !manifest.capabilities.includes("bulkInsert") || manifest.capabilities.includes("transactions"),
    { message: "the bulkInsert capability requires transactions", path: ["capabilities"] },
  )
  // Object DDL is planned against described tables and reads its names from the introspector (decision 052).
  .refine(
    (manifest) =>
      !manifest.capabilities.includes("objects") ||
      (manifest.capabilities.includes("sql") && manifest.capabilities.includes("schemaTree")),
    { message: "the objects capability requires sql and schemaTree", path: ["capabilities"] },
  );

export type PluginManifest = z.infer<typeof pluginManifestSchema>;
