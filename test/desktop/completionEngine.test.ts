import { describe, expect, it } from "vitest";
import type { PluginLoadResult } from "@table-craft/core";
import sqlite from "@table-craft/plugin-sqlite";
import { createEngine } from "@table-craft/desktop/engine/engine.js";
import type { CompletionResult, Declaration, EngineResponse } from "@table-craft/desktop/engine/protocol.js";
import { SQLITE_MANIFEST } from "../support/manifests.js";
import { seededSqliteFile } from "../support/sqliteFixture.js";

const LOADED_SQLITE: PluginLoadResult = {
  status: "loaded",
  directory: "plugins/sqlite",
  manifest: SQLITE_MANIFEST,
  plugin: sqlite,
};

function connection() {
  const path = seededSqliteFile();
  return createEngine({
    datasource: { id: "seeded", pluginId: "sqlite", config: { path }, readOnly: false },
    plugins: [LOADED_SQLITE],
  }).connect();
}

function resultOf<T>(response: EngineResponse): T {
  if (response.type === "engine.error") throw new Error(`unexpected engine error: ${response.error.message}`);
  return response.result as T;
}

describe("engine completion", () => {
  it("givenFromClause_whenCompleting_thenOffersSeededTablesWithoutAConsoleSession", async () => {
    const engine = connection();
    const text = "SELECT * FROM ";

    const result = resultOf<CompletionResult>(
      await engine.handle({ id: 1, type: "completion.complete", text, offset: text.length }),
    );

    expect(result.from).toBe(text.length);
    expect(result.items.filter((item) => item.kind === "table").map((item) => item.label)).toEqual(
      expect.arrayContaining(["customers", "orders", "Line Items"]),
    );
  });

  it("givenCurrent_whenCompleting_thenCompletesAgainstIt", async () => {
    const engine = connection();
    const text = "SELECT * FROM ";
    const tables = async (current?: readonly string[]) =>
      resultOf<CompletionResult>(
        await engine.handle({
          id: 1,
          type: "completion.complete",
          text,
          offset: text.length,
          ...(current === undefined ? {} : { current }),
        }),
      ).items.filter((item) => item.kind === "table");

    expect((await tables(["main"])).map((item) => item.label)).toContain("orders");
    expect(await tables(["nowhere"])).toEqual([]);
  });

  it("givenScopeParam_whenCompletingWhereBar_thenOffersTableColumns", async () => {
    const engine = connection();

    const result = resultOf<CompletionResult>(
      await engine.handle({
        id: 1,
        type: "completion.complete",
        text: "cust",
        offset: 4,
        scope: { path: ["main"], relation: "orders" },
      }),
    );

    expect(result.from).toBe(0);
    expect(result.items).toContainEqual(expect.objectContaining({ label: "customer_id", kind: "column" }));
  });

  it("givenAliasReference_whenResolving_thenReturnsDeclarationSpan", async () => {
    const engine = connection();
    const text = "SELECT o.total FROM orders o";

    const declaration = resultOf<Declaration | null>(
      await engine.handle({ id: 1, type: "navigation.resolve", text, offset: 7 }),
    );

    expect(declaration).toEqual({ kind: "alias", from: 20, to: 28 });
  });

  it("givenRelationReference_whenResolving_thenReturnsPathAndRelation", async () => {
    const engine = connection();
    const text = "SELECT * FROM customers";

    const declaration = resultOf<Declaration | null>(
      await engine.handle({ id: 1, type: "navigation.resolve", text, offset: 16 }),
    );

    expect(declaration).toEqual({ kind: "relation", path: ["main"], relation: "customers" });
  });

  it("givenOffsetPastText_whenCompleting_thenInvalidRequest", async () => {
    const engine = connection();

    const response = await engine.handle({ id: 1, type: "completion.complete", text: "SEL", offset: 9 });

    expect(response.type).toBe("engine.error");
    expect(response.type === "engine.error" && response.error.code).toBe("invalidRequest");
  });
});
