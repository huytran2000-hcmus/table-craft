import { API_VERSION, pluginManifestSchema, z, type PluginManifest } from "@table-craft/plugin-api";
import { connectionFormProblems } from "@table-craft/plugin-api/testing";
import { describe, expect, it } from "vitest";

const VALID_MANIFEST = {
  id: "sqlite",
  name: "SQLite",
  version: "1.0.0",
  apiVersion: API_VERSION,
  entry: "index.js",
  capabilities: ["sql"],
  highlight: "sqlite",
  connection: { fields: [{ key: "path", label: "File", kind: "file", required: true }] },
};

const SERVER_SCHEMA = z.strictObject({
  host: z.string(),
  user: z.string(),
  password: z.string().default(""),
});

function serverManifest(fields: readonly unknown[]): PluginManifest {
  return pluginManifestSchema.parse({ ...VALID_MANIFEST, id: "server", connection: { fields } });
}

const HOST = { key: "host", label: "Host", kind: "text", required: true };
const USER = { key: "user", label: "User", kind: "text", required: true };
const PASSWORD = { key: "password", label: "Password", kind: "password", secret: true };

describe("pluginManifestSchema", () => {
  it("givenValidManifest_whenParsed_thenReturnsManifest", () => {
    expect(pluginManifestSchema.parse(VALID_MANIFEST)).toEqual(VALID_MANIFEST);
  });

  it("givenUnknownCapability_whenParsed_thenFails", () => {
    const result = pluginManifestSchema.safeParse({ ...VALID_MANIFEST, capabilities: ["teleport"] });
    expect(result.success).toBe(false);
  });

  it("givenNonSemverApiVersion_whenParsed_thenFails", () => {
    const result = pluginManifestSchema.safeParse({ ...VALID_MANIFEST, apiVersion: "latest" });
    expect(result.success).toBe(false);
  });

  it("givenUnknownField_whenParsed_thenFails", () => {
    const result = pluginManifestSchema.safeParse({ ...VALID_MANIFEST, main: "index.js" });
    expect(result.success).toBe(false);
  });

  it("givenNoConnectionForm_whenParsed_thenFails", () => {
    const { connection: _omitted, ...withoutForm } = VALID_MANIFEST;
    expect(pluginManifestSchema.safeParse(withoutForm).success).toBe(false);
  });

  it("givenUnknownFieldKind_whenParsed_thenFails", () => {
    const fields = [{ key: "path", label: "File", kind: "colour" }];
    expect(pluginManifestSchema.safeParse({ ...VALID_MANIFEST, connection: { fields } }).success).toBe(false);
  });
});

describe("connectionFormProblems", () => {
  it("givenAgreeingFormAndSchema_whenCompared_thenNoProblems", () => {
    expect(connectionFormProblems(serverManifest([HOST, USER, PASSWORD]), SERVER_SCHEMA)).toEqual([]);
  });

  it("givenPasswordFieldNotSecret_whenContractRuns_thenFails", () => {
    const leaky = serverManifest([HOST, USER, { ...PASSWORD, secret: false }]);

    expect(connectionFormProblems(leaky, SERVER_SCHEMA)).toEqual(['Password field "password" must be marked secret.']);
  });

  it("givenFieldTheSchemaRejects_whenCompared_thenNamesIt", () => {
    const extra = serverManifest([HOST, USER, PASSWORD, { key: "schema", label: "Schema", kind: "text" }]);

    expect(connectionFormProblems(extra, SERVER_SCHEMA)).toEqual([
      'Field "schema" is not accepted by connectionSchema.',
    ]);
  });

  it("givenRequiredKeyWithoutField_whenCompared_thenNamesIt", () => {
    expect(connectionFormProblems(serverManifest([HOST, PASSWORD]), SERVER_SCHEMA)).toEqual([
      'connectionSchema requires "user", but no connection field fills it.',
    ]);
  });
});
