import { describe, expect, expectTypeOf, it } from "vitest";
import {
  EXTRACTOR_KINDS,
  RESULT_FETCH_ALL_CAP,
  RESULT_PAGE_ROWS,
  RESULT_WINDOW_ROWS,
  type CachedCatalog,
  type CoreErrorCode,
  type ExtractorKind,
  type ResultState,
  type ResultSummary,
  type SortKey,
  type TypeClass,
} from "@table-craft/core";
import {
  CAPABILITIES,
  MANIFEST_FILE,
  type Capability,
  type Column,
  type Namespace,
  type NamespaceCatalog,
  type PluginErrorCode,
  type StatementClass,
  type StatementSpan,
  type TransactionMode,
  type WireValue,
} from "@table-craft/plugin-api";
import * as protocol from "@table-craft/desktop/engine/protocol.js";

describe("engine protocol", () => {
  it("givenProtocolConstants_whenComparedWithCore_thenEqual", () => {
    expect(protocol.RESULT_WINDOW_ROWS).toBe(RESULT_WINDOW_ROWS);
    expect(protocol.RESULT_PAGE_ROWS).toBe(RESULT_PAGE_ROWS);
    expect(protocol.RESULT_FETCH_ALL_CAP).toBe(RESULT_FETCH_ALL_CAP);
  });

  it("givenResultTypes_whenComparedWithCore_thenIdentical", () => {
    expectTypeOf<protocol.ResultState>().toEqualTypeOf<ResultState>();
    expectTypeOf<protocol.SortKey>().toEqualTypeOf<SortKey>();
    expectTypeOf<protocol.TypeClass>().toEqualTypeOf<TypeClass>();
    expectTypeOf<protocol.ExtractorKind>().toEqualTypeOf<ExtractorKind>();
    expect(protocol.EXTRACTOR_KINDS).toEqual(EXTRACTOR_KINDS);
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
    expectTypeOf<Omit<protocol.ExecutedStatement, "firstWindow" | "transactionOpen">>().toEqualTypeOf<ResultSummary>();
  });

  it("givenScriptTypes_whenComparedWithPluginApi_thenIdentical", () => {
    expectTypeOf<protocol.ClassifiedStatement>().toExtend<StatementSpan & StatementClass>();
    expectTypeOf<StatementSpan & StatementClass>().toExtend<protocol.ClassifiedStatement>();
    expectTypeOf<keyof protocol.ClassifiedStatement>().toEqualTypeOf<keyof (StatementSpan & StatementClass)>();
    expectTypeOf<protocol.TransactionMode>().toEqualTypeOf<TransactionMode>();
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
