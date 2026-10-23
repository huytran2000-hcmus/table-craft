import { describe, expect, it } from "vitest";
import type { PluginLoadResult } from "@table-craft/core";
import mysql from "@table-craft/plugin-mysql";
import postgres from "@table-craft/plugin-postgres";
import sqlite from "@table-craft/plugin-sqlite";
import { createEngine } from "@table-craft/desktop/engine/engine.js";
import type { EngineResponse, Namespace, SwitchStatement } from "@table-craft/desktop/engine/protocol.js";
import { MYSQL_MANIFEST, POSTGRES_MANIFEST, SQLITE_MANIFEST } from "../support/manifests.js";
import { seededSqliteFile } from "../support/sqliteFixture.js";

type LoadedPlugin = Extract<PluginLoadResult, { status: "loaded" }>;

const LOADED_SQLITE: LoadedPlugin = {
  status: "loaded",
  directory: "plugins/sqlite",
  manifest: SQLITE_MANIFEST,
  plugin: sqlite,
};
const LOADED_MYSQL: LoadedPlugin = {
  status: "loaded",
  directory: "plugins/mysql",
  manifest: MYSQL_MANIFEST,
  plugin: mysql,
};
const LOADED_POSTGRES: LoadedPlugin = {
  status: "loaded",
  directory: "plugins/postgres",
  manifest: POSTGRES_MANIFEST,
  plugin: postgres,
};
const UNREACHABLE = { host: "127.0.0.1", port: 1, database: "none", user: "none", password: "none" };

function connection(plugin: LoadedPlugin, config: Record<string, unknown>) {
  return createEngine({
    datasource: { id: "switch", pluginId: plugin.manifest.id, config, readOnly: false, keepAliveSeconds: 0 },
    plugins: [plugin],
  }).connect();
}

function resultOf<T>(response: EngineResponse): T {
  if (response.type === "engine.error") throw new Error(`unexpected engine error: ${response.error.message}`);
  return response.result as T;
}

describe("engine namespace switch", () => {
  it("givenPluginWithoutCurrentNamespace_whenTargetsAsked_thenInvalidRequest", async () => {
    const engine = connection(LOADED_SQLITE, { path: seededSqliteFile() });

    const targets = await engine.handle({ id: 1, type: "namespace.targets" });
    const statement = await engine.handle({ id: 2, type: "namespace.switchStatement", path: ["main"] });

    expect(targets).toMatchObject({ type: "engine.error", error: { code: "invalidRequest" } });
    expect(statement).toMatchObject({ type: "engine.error", error: { code: "invalidRequest" } });
  });

  it("givenSwitchStatement_whenAsked_thenPluginsStatement", async () => {
    const mysqlEngine = connection(LOADED_MYSQL, UNREACHABLE);
    const postgresEngine = connection(LOADED_POSTGRES, UNREACHABLE);

    const use = resultOf<SwitchStatement>(
      await mysqlEngine.handle({ id: 1, type: "namespace.switchStatement", path: ["arc`hive"] }),
    );
    const searchPath = resultOf<SwitchStatement>(
      await postgresEngine.handle({ id: 1, type: "namespace.switchStatement", path: ["table_craft", "Archive"] }),
    );

    expect(use).toEqual({ sql: "USE `arc``hive`", transactional: false });
    expect(searchPath).toEqual({ sql: 'SET search_path TO "Archive"', transactional: true });
  });

  it("givenEmptyPath_whenSwitchStatementAsked_thenInvalidRequest", async () => {
    const engine = connection(LOADED_MYSQL, UNREACHABLE);

    const response = await engine.handle({ id: 1, type: "namespace.switchStatement", path: [] });

    expect(response).toMatchObject({ type: "engine.error", error: { code: "invalidRequest" } });
  });

  it("givenUnreachableDatabase_whenTargetsAsked_thenErrorNotTargets", async () => {
    const engine = connection(LOADED_MYSQL, UNREACHABLE);

    const response = await engine.handle({ id: 1, type: "namespace.targets" });

    expect(response.type).toBe("engine.error");
    expect((response as { result?: readonly Namespace[] }).result).toBeUndefined();
  });
});
