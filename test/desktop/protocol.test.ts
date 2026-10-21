import { describe, expect, expectTypeOf, it } from "vitest";
import {
  RESULT_FETCH_CAP,
  RESULT_WINDOW_ROWS,
  type CachedCatalog,
  type CoreErrorCode,
  type ResultSummary,
} from "@table-craft/core";
import {
  CAPABILITIES,
  MANIFEST_FILE,
  type Capability,
  type Column,
  type Namespace,
  type NamespaceCatalog,
  type PluginErrorCode,
  type WireValue,
} from "@table-craft/plugin-api";
import * as protocol from "@table-craft/desktop/engine/protocol.js";

describe("engine protocol", () => {
  it("givenProtocolConstants_whenComparedWithCore_thenEqual", () => {
    expect(protocol.RESULT_WINDOW_ROWS).toBe(RESULT_WINDOW_ROWS);
    expect(protocol.RESULT_FETCH_CAP).toBe(RESULT_FETCH_CAP);
  });

  it("givenProtocolWireTypes_whenComparedWithPluginApi_thenIdentical", () => {
    expectTypeOf<protocol.WireValue>().toEqualTypeOf<WireValue>();
    expectTypeOf<protocol.Column>().toEqualTypeOf<Column>();
    expectTypeOf<protocol.Capability>().toEqualTypeOf<Capability>();
  });

  it("givenNewCapability_whenProtocolCompared_thenMatchesPluginApi", () => {
    expectTypeOf<protocol.Capability>().toEqualTypeOf<(typeof CAPABILITIES)[number]>();
    expect(CAPABILITIES).toContain("schemaTree");
  });

  it("givenCatalogTypes_whenComparedWithPluginApiAndCore_thenIdentical", () => {
    expectTypeOf<protocol.Namespace>().toEqualTypeOf<Namespace>();
    expectTypeOf<protocol.NamespaceCatalog>().toEqualTypeOf<NamespaceCatalog>();
    expectTypeOf<protocol.DescribedCatalog>().toEqualTypeOf<CachedCatalog>();
  });

  it("givenPluginErrorCodes_whenComparedWithEngineErrorCodes_thenEveryOneIsCovered", () => {
    expectTypeOf<PluginErrorCode>().toExtend<protocol.EngineErrorCode>();
  });

  it("givenExecutedStatement_whenComparedWithCoreSummary_thenCarriesEveryField", () => {
    expectTypeOf<Omit<protocol.ExecutedStatement, "firstWindow">>().toEqualTypeOf<ResultSummary>();
  });

  it("givenCoreErrorCodes_whenComparedWithEngineErrorCodes_thenEveryOneIsCovered", () => {
    expectTypeOf<CoreErrorCode>().toExtend<protocol.EngineErrorCode>();
  });

  it("givenViteManifestName_whenComparedWithPluginApi_thenEqual", async () => {
    const { readFile } = await import("node:fs/promises");
    const config = await readFile(new URL("../../packages/desktop/vite.plugins.config.ts", import.meta.url), "utf8");
    expect(config).toContain(`const MANIFEST_FILE = "${MANIFEST_FILE}";`);
  });
});
