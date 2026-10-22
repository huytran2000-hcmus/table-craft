import { describe, expect, it } from "vitest";
import type { PluginLoadResult } from "@table-craft/core";
import sqlite from "@table-craft/plugin-sqlite";
import { createEngine } from "@table-craft/desktop/engine/engine.js";
import type {
  EngineResponse,
  ExecutedStatement,
  RowEdit,
  SubmittedEdits,
  TableQuery,
} from "@table-craft/desktop/engine/protocol.js";
import { SQLITE_MANIFEST } from "../support/manifests.js";
import { seededSqliteFile } from "../support/sqliteFixture.js";

const LOADED_SQLITE: PluginLoadResult = {
  status: "loaded",
  directory: "plugins/sqlite",
  manifest: SQLITE_MANIFEST,
  plugin: sqlite,
};
const MAIN = ["main"];
const EDIT_PROBE = "edit_probe";

function seededEngine(readOnly = false) {
  const path = seededSqliteFile();
  return createEngine({
    datasource: { id: "seeded", pluginId: "sqlite", config: { path }, readOnly },
    plugins: [LOADED_SQLITE],
  });
}

type Connection = ReturnType<ReturnType<typeof seededEngine>["connect"]>;

function resultOf<T>(response: EngineResponse): T {
  if (response.type === "engine.error") throw new Error(`unexpected engine error: ${response.error.message}`);
  return response.result as T;
}

async function openSession(connection: Connection): Promise<string> {
  return resultOf<{ sessionId: string }>(await connection.handle({ id: 1, type: "session.open" })).sessionId;
}

async function query(
  connection: Connection,
  sessionId: string,
  relation = EDIT_PROBE,
  where = "",
  orderBy = "",
): Promise<TableQuery> {
  return resultOf<TableQuery>(
    await connection.handle({ id: 2, type: "table.query", sessionId, path: MAIN, relation, where, orderBy }),
  );
}

async function opened(readOnly = false) {
  const connection = seededEngine(readOnly).connect();
  const sessionId = await openSession(connection);
  return { connection, sessionId };
}

describe("engine table editor", () => {
  it("givenWhereAndOrderBars_whenQueried_thenVerbatimClausesAndPrimaryKeyIdentity", async () => {
    const { connection, sessionId } = await opened();

    const table = await query(connection, sessionId, EDIT_PROBE, "qty >= 1;", "id DESC");

    expect(table.sql).toBe('SELECT * FROM "main"."edit_probe" WHERE qty >= 1 ORDER BY id DESC');
    expect(table.editable).toEqual({ identity: ["id"] });
    expect(table.columns.map((column) => column.name)).toEqual(["id", "label", "qty", "note", "doc"]);
    expect(table.statement.firstWindow.rows.map((row) => row[0])).toEqual([2, 1]);
  });

  it("givenTableWithoutKey_whenQueried_thenReadOnlyWithReason", async () => {
    const { connection, sessionId } = await opened();

    const table = await query(connection, sessionId, "no_key_probe");

    expect(table.editable).toEqual({ readOnly: "No primary key or non-null unique key identifies a row." });
  });

  it("givenView_whenQueried_thenReadOnly", async () => {
    const { connection, sessionId } = await opened();

    const table = await query(connection, sessionId, "customer_totals");

    expect(table.editable).toEqual({ readOnly: "Views are read-only." });
  });

  it("givenReadOnlyDatasource_whenQueried_thenReadOnly", async () => {
    const { connection, sessionId } = await opened(true);

    const table = await query(connection, sessionId);

    expect(table.editable).toEqual({ readOnly: "The datasource is read-only." });
  });

  it("givenBadWhere_whenQueried_thenStatementFailed", async () => {
    const { connection, sessionId } = await opened();

    const response = await connection.handle({
      id: 9,
      type: "table.query",
      sessionId,
      path: MAIN,
      relation: EDIT_PROBE,
      where: "nope = 1",
      orderBy: "",
    });

    expect(response).toMatchObject({ id: 9, type: "engine.error", error: { code: "statementFailed" } });
  });

  it("givenUnknownTable_whenQueried_thenInvalidRequestWithSynchronizeHint", async () => {
    const { connection, sessionId } = await opened();

    const response = await connection.handle({
      id: 9,
      type: "table.query",
      sessionId,
      path: MAIN,
      relation: "gone",
      where: "",
      orderBy: "",
    });

    expect(response).toMatchObject({ type: "engine.error", error: { code: "invalidRequest" } });
    expect(response.type === "engine.error" && response.error.hint).toMatch(/Synchronize/);
  });

  it("givenTableResult_whenLocalSortRequested_thenInvalidRequest", async () => {
    const { connection, sessionId } = await opened();
    const table = await query(connection, sessionId);

    const response = await connection.handle({
      id: 5,
      type: "result.sort",
      handle: table.statement.handle,
      keys: [{ column: 1, direction: "asc" }],
    });

    expect(response).toMatchObject({ id: 5, type: "engine.error", error: { code: "invalidRequest" } });
  });

  it("givenEdits_whenPreviewed_thenDeletesUpdatesInsertsWithPluginLiterals", async () => {
    const { connection, sessionId } = await opened();
    const table = await query(connection, sessionId, EDIT_PROBE, "", "id");
    const edits: RowEdit[] = [
      { kind: "insert", values: [{ kind: "default" }, { kind: "text", text: "third" }, ...defaults(3)] },
      { kind: "update", row: 0, values: [{ column: 3, value: { kind: "text", text: "it's" } }] },
      { kind: "delete", row: 1 },
    ];

    const statements = resultOf<string[]>(
      await connection.handle({ id: 6, type: "edits.preview", handle: table.statement.handle, edits }),
    );

    expect(statements).toEqual([
      'DELETE FROM "main"."edit_probe" WHERE "id" = 2',
      `UPDATE "main"."edit_probe" SET "note" = 'it''s' WHERE "id" = 1`,
      `INSERT INTO "main"."edit_probe" ("label") VALUES ('third')`,
    ]);
  });

  it("givenEdits_whenSubmitted_thenRequeryShowsThem", async () => {
    const { connection, sessionId } = await opened();
    const table = await query(connection, sessionId, EDIT_PROBE, "", "id");
    const edits: RowEdit[] = [
      { kind: "update", row: 0, values: [{ column: 2, value: { kind: "text", text: "7" } }] },
      { kind: "insert", values: defaults(5) },
    ];

    const submitted = resultOf<SubmittedEdits>(
      await connection.handle({ id: 7, type: "edits.submit", sessionId, handle: table.statement.handle, edits }),
    );
    const after = await query(connection, sessionId, EDIT_PROBE, "", "id");

    expect(submitted.rowsAffected).toBe(2);
    expect(after.statement.firstWindow.rows.map((row) => [row[0], row[1], row[2]])).toEqual([
      [1, "first", 7],
      [2, "second", 2],
      [3, "new", 1],
    ]);
  });

  it("givenRowDeletedElsewhere_whenUpdateSubmitted_thenEditRejectedAndBatchRolledBack", async () => {
    const engine = seededEngine();
    const connection = engine.connect();
    const sessionId = await openSession(connection);
    const other = await openSession(connection);
    const table = await query(connection, sessionId, EDIT_PROBE, "", "id");
    resultOf<ExecutedStatement>(
      await connection.handle({
        id: 3,
        type: "statement.execute",
        sessionId: other,
        sql: "DELETE FROM edit_probe WHERE id = 2",
      }),
    );
    const edits: RowEdit[] = [
      { kind: "update", row: 0, values: [{ column: 1, value: { kind: "text", text: "changed" } }] },
      { kind: "update", row: 1, values: [{ column: 1, value: { kind: "text", text: "lost" } }] },
    ];

    const response = await connection.handle({
      id: 8,
      type: "edits.submit",
      sessionId,
      handle: table.statement.handle,
      edits,
    });
    const after = await query(connection, sessionId, EDIT_PROBE, "", "id");

    expect(response).toMatchObject({ type: "engine.error", error: { code: "editRejected", statementIndex: 1 } });
    expect(after.statement.firstWindow.rows.map((row) => row[1])).toEqual(["first"]);
  });

  it("givenReadOnlyTable_whenSubmitted_thenInvalidRequestWithReason", async () => {
    const { connection, sessionId } = await opened();
    const table = await query(connection, sessionId, "no_key_probe");

    const response = await connection.handle({
      id: 8,
      type: "edits.submit",
      sessionId,
      handle: table.statement.handle,
      edits: [{ kind: "delete", row: 0 }],
    });

    expect(response).toMatchObject({
      type: "engine.error",
      error: { code: "invalidRequest", message: "No primary key or non-null unique key identifies a row." },
    });
  });

  it("givenWhereBar_whenCounted_thenRowsItLetsThrough", async () => {
    const { connection } = await opened();

    const response = await connection.handle({
      id: 10,
      type: "table.count",
      path: MAIN,
      relation: EDIT_PROBE,
      where: "qty > 1",
    });

    expect(resultOf<number>(response)).toBe(1);
  });

  it("givenFkCell_whenGoToReferenced_thenTargetFilterOnTargetColumns", async () => {
    const { connection, sessionId } = await opened();
    const table = await query(connection, sessionId, EDIT_PROBE, "", "id");

    const single = await connection.handle({
      id: 11,
      type: "table.condition",
      handle: table.statement.handle,
      rows: [0],
      columns: [{ column: 1, name: "name" }],
    });
    const several = await connection.handle({
      id: 12,
      type: "table.condition",
      handle: table.statement.handle,
      rows: [0, 1, 0],
      columns: [{ column: 3, name: "note" }],
    });

    expect(resultOf<string>(single)).toBe(`"name" = 'first'`);
    expect(resultOf<string>(several)).toBe(`("note" = 'kept' OR "note" IS NULL)`);
  });

  it("givenOrdersReferenceCustomers_whenCustomersQueried_thenOrdersForeignKeyListed", async () => {
    const { connection, sessionId } = await opened();

    const orders = await query(connection, sessionId, "orders");
    const customers = await query(connection, sessionId, "customers");

    expect(orders.foreignKeys.map((key) => [key.columns, key.target.relation, key.target.columns])).toEqual([
      [["customer_id"], "customers", ["id"]],
    ]);
    expect(customers.referencing.map((key) => [key.relation, key.foreignKey.columns])).toEqual([
      ["orders", ["customer_id"]],
    ]);
  });

  it("givenHeaderSortTerms_whenOrderByRequested_thenPluginQuotedClause", async () => {
    const { connection } = await opened();

    const clause = await connection.handle({
      id: 13,
      type: "table.orderBy",
      terms: [
        { name: "qty", direction: "desc" },
        { name: "label", direction: "asc" },
      ],
    });

    expect(resultOf<string>(clause)).toBe(`"qty" DESC, "label"`);
  });
});

function defaults(count: number): { readonly kind: "default" }[] {
  return Array.from({ length: count }, () => ({ kind: "default" as const }));
}
