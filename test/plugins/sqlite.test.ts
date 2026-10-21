import { openSession, ResultStore, type PluginLoadResult } from "@table-craft/core";
import { API_VERSION, type Row } from "@table-craft/plugin-api";
import { runPluginContract } from "@table-craft/plugin-api/testing";
import sqlite from "@table-craft/plugin-sqlite";
import { describe, expect, it } from "vitest";

const IN_MEMORY = { path: ":memory:" };
const BEYOND_SAFE_INTEGER = "9007199254740993";

const LOADED: PluginLoadResult[] = [
  {
    status: "loaded",
    directory: "builtin/sqlite",
    manifest: {
      id: "sqlite",
      name: "SQLite",
      version: "0.0.0",
      apiVersion: API_VERSION,
      entry: "index.js",
      capabilities: ["sql"],
      highlight: "sqlite",
    },
    plugin: sqlite,
  },
];

async function collect(rows: AsyncIterable<Row>): Promise<Row[]> {
  const collected: Row[] = [];
  for await (const row of rows) collected.push(row);
  return collected;
}

runPluginContract(sqlite, { config: IN_MEMORY });

describe("sqlite plugin", () => {
  it("givenSqliteSession_whenSelectOne_thenReturnsColumnsAndOneRow", async () => {
    const session = await sqlite.connect(IN_MEMORY);
    try {
      const result = await session.execute("SELECT 1 AS one, 'two' AS two");

      expect(result.columns).toEqual([
        { name: "one", type: null },
        { name: "two", type: null },
      ]);
      expect(await collect(result.rows)).toEqual([[1, "two"]]);
    } finally {
      await session.close();
    }
  });

  it("givenIntegerBeyondSafeRange_whenSelected_thenTaggedAsBigInt", async () => {
    const session = await sqlite.connect(IN_MEMORY);
    try {
      const result = await session.execute(`SELECT ${BEYOND_SAFE_INTEGER} AS big, x'00ff' AS blob`);

      expect(await collect(result.rows)).toEqual([
        [
          { kind: "bigint", value: BEYOND_SAFE_INTEGER },
          { kind: "bytes", preview: "00ff", length: 2 },
        ],
      ]);
    } finally {
      await session.close();
    }
  });

  it("givenLoadedSqlite_whenOpenedThroughCore_thenResultIsStored", async () => {
    const session = await openSession(LOADED, "sqlite", IN_MEMORY);
    const store = new ResultStore();
    try {
      const summary = await store.put(await session.execute("SELECT 1 AS one, 'two' AS two"));

      expect(store.window(summary.handle, 0).rows).toEqual([[1, "two"]]);
    } finally {
      await session.close();
    }
  });

  it("givenInvalidConfig_whenOpenedThroughCore_thenInvalidConfigError", async () => {
    await expect(openSession(LOADED, "sqlite", { file: ":memory:" })).rejects.toMatchObject({ code: "invalidConfig" });
  });

  it("givenNoSuchPlugin_whenOpenedThroughCore_thenUnknownPluginError", async () => {
    await expect(openSession(LOADED, "oracle", IN_MEMORY)).rejects.toMatchObject({ code: "unknownPlugin" });
  });
});
