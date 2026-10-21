import { describe, expect, it } from "vitest";
import {
  API_VERSION,
  PluginError,
  pluginManifestSchema,
  z,
  type DatasourcePlugin,
  type Session,
} from "@table-craft/plugin-api";
import type { PluginLoadResult } from "@table-craft/core";
import sqlite from "@table-craft/plugin-sqlite";
import { createEngine } from "@table-craft/desktop/engine/engine.js";
import type { EngineResponse, ExecutedStatement, ResultWindow } from "@table-craft/desktop/engine/protocol.js";
import { RESULT_WINDOW_ROWS } from "@table-craft/desktop/engine/protocol.js";
import manifestJson from "../../plugins/sqlite/table-craft-plugin.json" with { type: "json" };

const SQLITE_DIRECTORY = "plugins/sqlite";
const LOADED_SQLITE: PluginLoadResult = {
  status: "loaded",
  directory: SQLITE_DIRECTORY,
  manifest: pluginManifestSchema.parse(manifestJson),
  plugin: sqlite,
};
const DATASOURCE = { id: "scratch", pluginId: "sqlite", config: { path: ":memory:" } };
const ROWS_1200 = "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1200) SELECT i FROM n";

const CANCELLABLE_ID = "cancellable";

/** Its one statement runs until cancelled; enough to drive `statement.cancel` without a database. */
function cancellablePlugin(): { plugin: DatasourcePlugin; cancels: () => number } {
  let cancels = 0;
  let stop: (() => void) | null = null;
  const session: Session = {
    execute: () =>
      new Promise((_resolve, reject) => {
        stop = () => reject(new PluginError("cancelled", "cancelled by the test"));
      }),
    cancel: () => {
      cancels += 1;
      stop?.();
      stop = null;
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  };
  const plugin: DatasourcePlugin = {
    id: CANCELLABLE_ID,
    capabilities: ["sql", "cancel"],
    connectionSchema: z.object({}),
    connect: () => Promise.resolve(session),
  };
  return { plugin, cancels: () => cancels };
}

function connectedToCancellable(plugin: DatasourcePlugin) {
  const loaded: PluginLoadResult = {
    status: "loaded",
    directory: "plugins/cancellable",
    manifest: pluginManifestSchema.parse({
      id: CANCELLABLE_ID,
      name: "Cancellable",
      version: "0.0.0",
      apiVersion: API_VERSION,
      entry: "index.js",
      capabilities: ["sql", "cancel"],
      highlight: "sql",
    }),
    plugin,
  };
  return createEngine({ datasource: { id: "c", pluginId: CANCELLABLE_ID, config: {} }, plugins: [loaded] }).connect();
}

function connected() {
  return createEngine({ datasource: DATASOURCE, plugins: [LOADED_SQLITE] }).connect();
}

function resultOf<T>(response: EngineResponse): T {
  if (response.type === "engine.error") throw new Error(`unexpected engine error: ${response.error.message}`);
  return response.result as T;
}

async function openSession(connection: ReturnType<typeof connected>): Promise<string> {
  return resultOf<{ sessionId: string }>(await connection.handle({ id: 1, type: "session.open" })).sessionId;
}

describe("engine", () => {
  it("givenOpenSession_whenSelectOneExecuted_thenRespondsWithColumnsAndFirstWindow", async () => {
    const connection = connected();
    const sessionId = await openSession(connection);

    const response = await connection.handle({
      id: 2,
      type: "statement.execute",
      sessionId,
      sql: "SELECT 1 AS one, 'two' AS two",
    });

    expect(response.id).toBe(2);
    const executed = resultOf<ExecutedStatement>(response);
    expect(executed.columns.map((column) => column.name)).toEqual(["one", "two"]);
    expect(executed.rowCount).toBe(1);
    expect(executed.firstWindow).toEqual({ offset: 0, rows: [[1, "two"]] });
  });

  it("givenResultOf1200Rows_whenWindowRequestedAt1000_thenReturns200Rows", async () => {
    const connection = connected();
    const sessionId = await openSession(connection);
    const { handle, firstWindow } = resultOf<ExecutedStatement>(
      await connection.handle({ id: 2, type: "statement.execute", sessionId, sql: ROWS_1200 }),
    );
    expect(firstWindow.rows).toHaveLength(RESULT_WINDOW_ROWS);

    const window = resultOf<ResultWindow>(
      await connection.handle({ id: 3, type: "result.window", handle, offset: 1000, limit: RESULT_WINDOW_ROWS }),
    );

    expect(window.rows).toHaveLength(200);
    expect(window.rows[0]).toEqual([1001]);
  });

  it("givenReleasedHandle_whenWindowRequested_thenUnknownHandleError", async () => {
    const connection = connected();
    const sessionId = await openSession(connection);
    const { handle } = resultOf<ExecutedStatement>(
      await connection.handle({ id: 2, type: "statement.execute", sessionId, sql: "SELECT 1" }),
    );
    await connection.handle({ id: 3, type: "result.release", handle });

    const response = await connection.handle({ id: 4, type: "result.window", handle, offset: 0, limit: 1 });

    expect(response).toMatchObject({ id: 4, type: "engine.error", error: { code: "unknownHandle" } });
  });

  it("givenHandleFromAnotherConnection_whenWindowRequested_thenUnknownHandleError", async () => {
    const engine = createEngine({ datasource: DATASOURCE, plugins: [LOADED_SQLITE] });
    const owner = engine.connect();
    const sessionId = resultOf<{ sessionId: string }>(await owner.handle({ id: 1, type: "session.open" })).sessionId;
    const { handle } = resultOf<ExecutedStatement>(
      await owner.handle({ id: 2, type: "statement.execute", sessionId, sql: "SELECT 1" }),
    );

    const response = await engine.connect().handle({ id: 1, type: "result.window", handle, offset: 0, limit: 1 });

    expect(response).toMatchObject({ type: "engine.error", error: { code: "unknownHandle" } });
  });

  it("givenInvalidSql_whenExecuted_thenStatementFailedWithHint", async () => {
    const connection = connected();
    const sessionId = await openSession(connection);

    const response = await connection.handle({ id: 2, type: "statement.execute", sessionId, sql: "SELEC 1" });

    expect(response).toMatchObject({ id: 2, type: "engine.error", error: { code: "statementFailed" } });
    if (response.type === "engine.error") expect(response.error.hint).not.toBe("");
  });

  it("givenUnknownSession_whenExecuted_thenUnknownSessionError", async () => {
    const response = await connected().handle({ id: 7, type: "statement.execute", sessionId: "nope", sql: "SELECT 1" });

    expect(response).toMatchObject({ id: 7, type: "engine.error", error: { code: "unknownSession" } });
  });

  it("givenMalformedRequest_whenHandled_thenInvalidRequestErrorKeepsTheId", async () => {
    const response = await connected().handle({ id: 9, type: "result.window", handle: "result-1" });

    expect(response).toMatchObject({ id: 9, type: "engine.error", error: { code: "invalidRequest" } });
  });

  it("givenUnavailablePlugin_whenSessionOpened_thenPluginUnavailableError", async () => {
    const connection = createEngine({
      datasource: DATASOURCE,
      plugins: [
        { status: "unavailable", directory: SQLITE_DIRECTORY, manifest: LOADED_SQLITE.manifest, reason: "broken" },
      ],
    }).connect();

    const response = await connection.handle({ id: 1, type: "session.open" });

    expect(response).toMatchObject({ type: "engine.error", error: { code: "pluginUnavailable" } });
  });

  it("givenClosedConnection_whenItsHandleRequestedAgain_thenUnknownHandleError", async () => {
    const connection = connected();
    const sessionId = await openSession(connection);
    const { handle } = resultOf<ExecutedStatement>(
      await connection.handle({ id: 2, type: "statement.execute", sessionId, sql: "SELECT 1" }),
    );

    await connection.close();
    const response = await connection.handle({ id: 3, type: "result.window", handle, offset: 0, limit: 1 });

    expect(response).toMatchObject({ type: "engine.error", error: { code: "unknownHandle" } });
  });

  it("givenSessionOpened_whenAnswered_thenCarriesPluginNameAndCapabilities", async () => {
    const response = await connected().handle({ id: 1, type: "session.open" });

    expect(resultOf(response)).toMatchObject({ pluginName: "SQLite", capabilities: ["sql"] });
  });

  it("givenUnreachableDatabase_whenSessionOpened_thenConnectionFailedError", async () => {
    const connection = createEngine({
      datasource: { ...DATASOURCE, config: { path: "/nonexistent-table-craft-directory/db.sqlite" } },
      plugins: [LOADED_SQLITE],
    }).connect();

    const response = await connection.handle({ id: 1, type: "session.open" });

    expect(response).toMatchObject({ type: "engine.error", error: { code: "connectionFailed" } });
  });

  it("givenCancelRequest_whenEngineHasNoCancelCapability_thenInvalidRequestError", async () => {
    const connection = connected();
    const sessionId = await openSession(connection);

    const response = await connection.handle({ id: 2, type: "statement.cancel", sessionId });

    expect(response).toMatchObject({ id: 2, type: "engine.error", error: { code: "invalidRequest" } });
  });

  it("givenRunningStatement_whenCancelled_thenExecuteFailsWithCancelled", async () => {
    const { plugin, cancels } = cancellablePlugin();
    const connection = connectedToCancellable(plugin);
    const sessionId = await openSession(connection);
    const running = connection.handle({ id: 2, type: "statement.execute", sessionId, sql: "SELECT forever()" });

    const cancelled = await connection.handle({ id: 3, type: "statement.cancel", sessionId });

    expect(cancelled).toEqual({ id: 3, type: "statement.cancel", result: null });
    expect(await running).toMatchObject({ id: 2, type: "engine.error", error: { code: "cancelled" } });
    expect(cancels()).toBe(1);
  });

  it("givenOpenSession_whenClosed_thenItsHandlesAreReleased", async () => {
    const connection = connected();
    const closing = await openSession(connection);
    const kept = await openSession(connection);
    const { handle: closedHandle } = resultOf<ExecutedStatement>(
      await connection.handle({ id: 2, type: "statement.execute", sessionId: closing, sql: "SELECT 1" }),
    );
    const { handle: keptHandle } = resultOf<ExecutedStatement>(
      await connection.handle({ id: 3, type: "statement.execute", sessionId: kept, sql: "SELECT 2" }),
    );

    const closed = await connection.handle({ id: 4, type: "session.close", sessionId: closing });

    expect(closed).toEqual({ id: 4, type: "session.close", result: null });
    expect(
      await connection.handle({ id: 5, type: "result.window", handle: closedHandle, offset: 0, limit: 1 }),
    ).toMatchObject({ type: "engine.error", error: { code: "unknownHandle" } });
    expect(
      resultOf<ResultWindow>(
        await connection.handle({ id: 6, type: "result.window", handle: keptHandle, offset: 0, limit: 1 }),
      ).rows,
    ).toEqual([[2]]);
  });

  it("givenClosedSession_whenExecuted_thenUnknownSessionError", async () => {
    const connection = connected();
    const sessionId = await openSession(connection);
    await connection.handle({ id: 2, type: "session.close", sessionId });

    const response = await connection.handle({ id: 3, type: "statement.execute", sessionId, sql: "SELECT 1" });

    expect(response).toMatchObject({ id: 3, type: "engine.error", error: { code: "unknownSession" } });
  });

  it("givenIdleSession_whenCancelled_thenAnswersNullWithoutCallingThePlugin", async () => {
    const { plugin, cancels } = cancellablePlugin();
    const connection = connectedToCancellable(plugin);
    const sessionId = await openSession(connection);

    const response = await connection.handle({ id: 2, type: "statement.cancel", sessionId });

    expect(response).toEqual({ id: 2, type: "statement.cancel", result: null });
    expect(cancels()).toBe(0);
  });
});
