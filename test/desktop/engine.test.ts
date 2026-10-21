import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PluginError, z, type DatasourcePlugin, type Session } from "@table-craft/plugin-api";
import type { PluginLoadResult } from "@table-craft/core";
import sqlite from "@table-craft/plugin-sqlite";
import { createEngine, probeDatasource } from "@table-craft/desktop/engine/engine.js";
import { createLifetime } from "@table-craft/desktop/engine/lifetime.js";
import type {
  ClassifiedStatement,
  DescribedCatalog,
  EngineResponse,
  ExecutedStatement,
  Namespace,
  ExportedResult,
  ResultState,
  ResultWindow,
  TransactionState,
} from "@table-craft/desktop/engine/protocol.js";
import { RESULT_WINDOW_ROWS } from "@table-craft/desktop/engine/protocol.js";
import { fakeManifest, SQLITE_MANIFEST } from "../support/manifests.js";
import { seededSqliteFile } from "../support/sqliteFixture.js";

const SQLITE_DIRECTORY = "plugins/sqlite";
const LOADED_SQLITE: PluginLoadResult = {
  status: "loaded",
  directory: SQLITE_DIRECTORY,
  manifest: SQLITE_MANIFEST,
  plugin: sqlite,
};
const DATASOURCE = { id: "scratch", pluginId: "sqlite", config: { path: ":memory:" }, readOnly: false };
const ROWS_1200 = "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1200) SELECT i FROM n";

const CANCELLABLE_ID = "cancellable";
const VERSION = /^\d+\.\d+/;

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
    serverVersion: null,
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
    manifest: fakeManifest({ id: CANCELLABLE_ID, name: "Cancellable", capabilities: ["sql", "cancel"] }),
    plugin,
  };
  return createEngine({
    datasource: { id: "c", pluginId: CANCELLABLE_ID, config: {}, readOnly: false },
    plugins: [loaded],
  }).connect();
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
    await connection.handle({ id: 3, type: "result.fetchMore", handle, all: true });

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

    expect(resultOf(response)).toMatchObject({
      pluginName: "SQLite",
      capabilities: ["sql", "schemaTree", "transactions"],
    });
  });

  it("givenSessionOpened_whenAnswered_thenCarriesServerVersion", async () => {
    const response = await connected().handle({ id: 1, type: "session.open" });

    expect(resultOf<{ serverVersion: string }>(response).serverVersion).toMatch(VERSION);
  });

  it("givenReadOnlyDatasource_whenWriting_thenStatementFailedWithReadOnlyHint", async () => {
    const connection = createEngine({
      datasource: { ...DATASOURCE, readOnly: true },
      plugins: [LOADED_SQLITE],
    }).connect();
    const sessionId = await openSession(connection);

    const response = await connection.handle({
      id: 2,
      type: "statement.execute",
      sessionId,
      sql: "CREATE TABLE t (n INTEGER)",
    });

    expect(response).toMatchObject({
      type: "engine.error",
      error: { code: "statementFailed", hint: expect.stringMatching(/read-only/) as unknown },
    });
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

/** The seeded fixture, through a plugin that counts the sessions it opens and closes. */
function countingSqlite(): { engine: ReturnType<typeof createEngine>; opened: () => number; closed: () => number } {
  let opened = 0;
  let closed = 0;
  const plugin: DatasourcePlugin = {
    ...sqlite,
    connect: async (config, options) => {
      opened += 1;
      const session = await sqlite.connect(config, options);
      return {
        execute: (sql) => session.execute(sql),
        introspector: session.introspector,
        serverVersion: session.serverVersion,
        close: () => {
          closed += 1;
          return session.close();
        },
      };
    },
  };
  const engine = createEngine({
    datasource: { id: "seeded", pluginId: "sqlite", config: { path: seededSqliteFile() }, readOnly: false },
    plugins: [{ status: "loaded", directory: SQLITE_DIRECTORY, manifest: SQLITE_MANIFEST, plugin }],
  });
  return { engine, opened: () => opened, closed: () => closed };
}

describe("engine catalog", () => {
  it("givenSchemaTreeDatasource_whenNamespacesRequested_thenMainIsCurrent", async () => {
    const { engine } = countingSqlite();

    const namespaces = resultOf<Namespace[]>(await engine.connect().handle({ id: 1, type: "catalog.namespaces" }));

    expect(namespaces.filter((namespace) => namespace.current).map((namespace) => namespace.path)).toEqual([["main"]]);
  });

  it("givenTwoConnections_whenBothDescribe_thenOneIntrospectionSessionAndOneRead", async () => {
    const { engine, opened } = countingSqlite();
    const [first, second] = [engine.connect(), engine.connect()];

    const [left, right] = await Promise.all([
      first.handle({ id: 1, type: "catalog.describe", path: ["main"] }),
      second.handle({ id: 1, type: "catalog.describe", path: ["main"] }),
    ]);

    expect(opened()).toBe(1);
    expect(resultOf<DescribedCatalog>(left).introspectedAt).toBe(resultOf<DescribedCatalog>(right).introspectedAt);
    expect(resultOf<DescribedCatalog>(left).catalog.relations.map((relation) => relation.name)).toContain("orders");
  });

  it("givenUnknownNamespace_whenDescribed_thenIntrospectionFailedWithHint", async () => {
    const { engine } = countingSqlite();

    const response = await engine.connect().handle({ id: 4, type: "catalog.describe", path: ["nowhere"] });

    expect(response).toMatchObject({ id: 4, type: "engine.error", error: { code: "introspectionFailed" } });
    expect(response.type === "engine.error" && response.error.hint).toMatch(/Synchronize/);
  });

  it("givenQualifiedNameRequest_whenAnswered_thenPluginQuotes", async () => {
    const { engine } = countingSqlite();

    const response = await engine
      .connect()
      .handle({ id: 5, type: "catalog.qualifiedName", path: ["main"], name: "orders" });

    expect(resultOf<string>(response)).toBe('"main"."orders"');
  });

  it("givenIntrospectionSession_whenEngineClosed_thenItIsClosed", async () => {
    const { engine, opened, closed } = countingSqlite();
    await engine.connect().handle({ id: 1, type: "catalog.namespaces" });

    await engine.close();

    expect([opened(), closed()]).toEqual([1, 1]);
  });

  it("givenEmptyPath_whenDescribed_thenInvalidRequest", async () => {
    const { engine } = countingSqlite();

    const response = await engine.connect().handle({ id: 6, type: "catalog.describe", path: [] });

    expect(response).toMatchObject({ id: 6, type: "engine.error", error: { code: "invalidRequest" } });
  });
});

describe("probeDatasource", () => {
  it("givenReachableDatabase_whenProbed_thenSucceedsWithVersionAndElapsed", async () => {
    const ticks = [100, 138];
    const result = await probeDatasource(
      { datasource: DATASOURCE, plugins: [LOADED_SQLITE] },
      () => ticks.shift() ?? 0,
    );

    expect(result).toMatchObject({ ok: true, pluginName: "SQLite", elapsedMs: 38 });
    expect(result.ok && result.serverVersion).toMatch(VERSION);
  });

  it("givenUnreachableDatabase_whenProbed_thenFailsWithConnectionFailedAndHint", async () => {
    const result = await probeDatasource({
      datasource: { ...DATASOURCE, config: { path: "/nonexistent-table-craft-directory/db.sqlite" } },
      plugins: [LOADED_SQLITE],
    });

    expect(result).toMatchObject({ ok: false, error: { code: "connectionFailed" } });
    expect(!result.ok && result.error.hint).toMatch(/\S/);
  });
});

describe("createLifetime", () => {
  it("givenLastPortClosed_whenEngineIdle_thenEngineExits", () => {
    let exits = 0;
    const lifetime = createLifetime(() => {
      exits += 1;
    });
    lifetime.attached();
    lifetime.attached();

    lifetime.detached();
    expect(exits).toBe(0);
    lifetime.detached();

    expect(exits).toBe(1);
  });

  it("givenNoPortEverAttached_whenDetachedReported_thenEngineStays", () => {
    let exits = 0;
    createLifetime(() => {
      exits += 1;
    }).detached();

    expect(exits).toBe(0);
  });
});

describe("engine scripts and transactions", () => {
  async function execute(connection: ReturnType<typeof connected>, sessionId: string, sql: string) {
    return resultOf<ExecutedStatement>(await connection.handle({ id: 3, type: "statement.execute", sessionId, sql }));
  }

  it("givenScript_whenSplitWithoutSession_thenClassifiedStatements", async () => {
    const text = "SELECT 1;\nDELETE FROM t;";

    const response = await connected().handle({ id: 1, type: "script.split", text });

    expect(resultOf<ClassifiedStatement[]>(response)).toEqual([
      { from: 0, to: 8, sql: "SELECT 1", kind: "read", destructive: null },
      { from: 10, to: 23, sql: "DELETE FROM t", kind: "write", destructive: "DELETE without WHERE" },
    ]);
  });

  it("givenTransactionRequest_whenPluginLacksTransactions_thenInvalidRequestError", async () => {
    const connection = connectedToCancellable(cancellablePlugin().plugin);
    const sessionId = await openSession(connection);

    const response = await connection.handle({ id: 2, type: "transaction.commit", sessionId });

    expect(response).toMatchObject({ id: 2, type: "engine.error", error: { code: "invalidRequest" } });
  });

  it("givenManualMode_whenInsertThenRollback_thenRowGoneAndNotOpen", async () => {
    const connection = connected();
    const sessionId = await openSession(connection);
    await execute(connection, sessionId, "CREATE TABLE t (n INTEGER)");

    const mode = await connection.handle({ id: 2, type: "transaction.setMode", sessionId, mode: "manual" });
    const inserted = await execute(connection, sessionId, "INSERT INTO t VALUES (1)");
    const rolledBack = await connection.handle({ id: 4, type: "transaction.rollback", sessionId });
    const counted = await execute(connection, sessionId, "SELECT count(*) AS n FROM t");

    expect(resultOf<TransactionState>(mode)).toEqual({ mode: "manual", transactionOpen: false });
    expect(inserted.transactionOpen).toBe(true);
    expect(resultOf<TransactionState>(rolledBack)).toEqual({ mode: "manual", transactionOpen: false });
    expect(counted.firstWindow.rows).toEqual([[0]]);
  });

  it("givenAutoMode_whenExplicitBegin_thenExecutedStatementCarriesTransactionOpen", async () => {
    const connection = connected();
    const sessionId = await openSession(connection);

    const begun = await execute(connection, sessionId, "BEGIN");
    const selected = await execute(connection, sessionId, "SELECT 1");
    const committed = await execute(connection, sessionId, "COMMIT");

    expect([begun, selected, committed].map((executed) => executed.transactionOpen)).toEqual([true, true, false]);
  });

  it("givenOpenTransaction_whenSwitchedToAuto_thenStatementFailedAndStillOpen", async () => {
    const connection = connected();
    const sessionId = await openSession(connection);
    await connection.handle({ id: 2, type: "transaction.setMode", sessionId, mode: "manual" });
    await execute(connection, sessionId, "SELECT 1");

    const response = await connection.handle({ id: 4, type: "transaction.setMode", sessionId, mode: "auto" });
    const committed = await connection.handle({ id: 5, type: "transaction.commit", sessionId });

    expect(response).toMatchObject({ type: "engine.error", error: { code: "statementFailed" } });
    expect(resultOf<TransactionState>(committed)).toEqual({ mode: "manual", transactionOpen: false });
  });
});

describe("engine results", () => {
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  async function execute(connection: ReturnType<typeof connected>, sessionId: string, sql: string) {
    return resultOf<ExecutedStatement>(await connection.handle({ id: 3, type: "statement.execute", sessionId, sql }));
  }

  async function fetchMore(connection: ReturnType<typeof connected>, handle: string, all = false) {
    return resultOf<ResultState>(await connection.handle({ id: 4, type: "result.fetchMore", handle, all }));
  }

  it("givenLargeResult_whenExecuted_thenFirstPageOnlyAndCursorOpen", async () => {
    const connection = connected();
    const sessionId = await openSession(connection);

    const executed = await execute(connection, sessionId, ROWS_1200);

    expect(executed).toMatchObject({ rowCount: 500, complete: false, cursorOpen: true, typeClasses: ["integer"] });
    expect(await fetchMore(connection, executed.handle)).toEqual({ rowCount: 1000, complete: false, cursorOpen: true });
    expect(await fetchMore(connection, executed.handle)).toEqual({ rowCount: 1200, complete: true, cursorOpen: false });
  });

  it("givenOpenCursor_whenSessionRunsAnotherStatement_thenCursorClosedRowsKept", async () => {
    const connection = connected();
    const sessionId = await openSession(connection);
    const first = await execute(connection, sessionId, ROWS_1200);

    await execute(connection, sessionId, "SELECT 1");
    const state = await fetchMore(connection, first.handle);
    const window = resultOf<ResultWindow>(
      await connection.handle({ id: 5, type: "result.window", handle: first.handle, offset: 0, limit: 500 }),
    );

    expect(state).toEqual({ rowCount: 500, complete: false, cursorOpen: false });
    expect(window.rows).toHaveLength(500);
  });

  it("givenOpenCursorInManualMode_whenCommitted_thenCursorClosedAndCommitSucceeds", async () => {
    const connection = connected();
    const sessionId = await openSession(connection);
    await connection.handle({ id: 2, type: "transaction.setMode", sessionId, mode: "manual" });
    const first = await execute(connection, sessionId, ROWS_1200);

    const committed = await connection.handle({ id: 5, type: "transaction.commit", sessionId });

    expect(resultOf<TransactionState>(committed)).toEqual({ mode: "manual", transactionOpen: false });
    expect((await fetchMore(connection, first.handle)).cursorOpen).toBe(false);
  });

  it("givenSortedResult_whenExtractedAsCsv_thenSortedRowsAndChosenColumns", async () => {
    const connection = connected();
    const sessionId = await openSession(connection);
    const { handle } = await execute(
      connection,
      sessionId,
      "SELECT 2 AS id, 'b' AS name UNION ALL SELECT 1, 'a' UNION ALL SELECT 3, 'c'",
    );

    await connection.handle({ id: 5, type: "result.sort", handle, keys: [{ column: 0, direction: "desc" }] });
    const text = await connection.handle({
      id: 6,
      type: "result.extract",
      handle,
      extractor: "csv",
      rows: [{ from: 0, to: 2 }],
      columns: [1],
    });

    expect(resultOf<string>(text)).toBe("name\nc\nb\n");
  });

  it("givenSqlInsertExtractor_whenExtracted_thenPluginQuotesNamesAndValues", async () => {
    const connection = connected();
    const sessionId = await openSession(connection);
    const { handle } = await execute(connection, sessionId, "SELECT 'it''s' AS \"a b\", X'00ff' AS blob");

    const text = await connection.handle({
      id: 6,
      type: "result.extract",
      handle,
      extractor: "sqlInsert",
      rows: [{ from: 0, to: 1 }],
      columns: [0, 1],
    });

    expect(resultOf<string>(text)).toBe(`INSERT INTO MY_TABLE ("a b", "blob") VALUES ('it''s', X'00ff');\n`);
  });

  it("givenOpenCursor_whenExported_thenFileHoldsEveryRowAndNoTempFile", async () => {
    const directory = await mkdtemp(join(tmpdir(), "table-craft-export-"));
    directories.push(directory);
    const path = join(directory, "rows.csv");
    const connection = connected();
    const sessionId = await openSession(connection);
    const { handle } = await execute(connection, sessionId, ROWS_1200);

    const exported = resultOf<ExportedResult>(
      await connection.handle({ id: 6, type: "result.export", handle, extractor: "csv", path, columns: [0] }),
    );
    const lines = (await readFile(path, "utf8")).trimEnd().split("\n");

    expect(exported).toMatchObject({ path, rows: 1200 });
    expect(exported.bytes).toBeGreaterThan(0);
    expect(lines).toHaveLength(1201);
    expect(lines.at(-1)).toBe("1200");
    expect(await readdir(directory)).toEqual(["rows.csv"]);
  });

  it("givenRelativePath_whenExported_thenInvalidRequest", async () => {
    const connection = connected();
    const sessionId = await openSession(connection);
    const { handle } = await execute(connection, sessionId, "SELECT 1");

    const response = await connection.handle({
      id: 6,
      type: "result.export",
      handle,
      extractor: "csv",
      path: "relative.csv",
      columns: [0],
    });

    expect(response).toMatchObject({ type: "engine.error", error: { code: "invalidRequest" } });
  });

  it("givenMissingFolder_whenExported_thenStatementFailedWithExportHint", async () => {
    const connection = connected();
    const sessionId = await openSession(connection);
    const { handle } = await execute(connection, sessionId, "SELECT 1");

    const response = await connection.handle({
      id: 6,
      type: "result.export",
      handle,
      extractor: "csv",
      path: join(tmpdir(), "table-craft-missing-folder", "rows.csv"),
      columns: [0],
    });

    expect(response).toMatchObject({ type: "engine.error", error: { code: "statementFailed" } });
  });
});
