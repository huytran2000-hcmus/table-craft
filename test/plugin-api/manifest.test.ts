import { API_VERSION, pluginManifestSchema } from "@table-craft/plugin-api";
import { describe, expect, it } from "vitest";

const VALID_MANIFEST = {
  id: "sqlite",
  name: "SQLite",
  version: "1.0.0",
  apiVersion: API_VERSION,
  entry: "index.js",
  capabilities: ["sql"],
  highlight: "sqlite",
};

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
});
