import { describe, expect, it, vi } from "vitest";
import type {
  ClassifiedStatement,
  ExecutedStatement,
  OpenedSession,
  TransactionMode,
  TransactionState,
} from "@table-craft/desktop/engine/protocol.js";
import { EngineRequestError, type EngineClient } from "@table-craft/desktop/renderer/engine/client.js";
import { executedText } from "@table-craft/desktop/renderer/model/format.js";
import { createConsolesStore, OUTPUT_TAB } from "@table-craft/desktop/renderer/state/consoles.js";

const SESSION_ID = "s1";

/** Splits on `;` and classifies by the first word, enough to drive the store the way a plugin would. */
function split(text: string): ClassifiedStatement[] {
  const statements: ClassifiedStatement[] = [];
  let start = 0;
  for (const piece of text.split(";")) {
    const lead = piece.length - piece.trimStart().length;
    const sql = piece.trim();
    if (sql !== "") {
      const from = start + lead;
      const verb = sql.split(/\s+/)[0]?.toUpperCase() ?? "";
      const kind =
        verb === "SELECT"
          ? "read"
          : verb === "CREATE" || verb === "DROP"
            ? "ddl"
            : verb === "BEGIN" || verb === "COMMIT" || verb === "ROLLBACK"
              ? "transaction"
              : "write";
      const destructive =
        verb === "DROP" ? "DROP TABLE" : verb === "DELETE" && !/\bWHERE\b/i.test(sql) ? "DELETE without WHERE" : null;
      statements.push({ from, to: from + sql.length, sql, kind, destructive });
    }
    start += piece.length + 1;
  }
  return statements;
}

/** An engine with one session: `FAIL` in a statement fails it; BEGIN, COMMIT, ROLLBACK and manual mode move its transaction. */
function fakeEngine() {
  const executed: string[] = [];
  const released: string[] = [];
  let mode: TransactionMode = "auto";
  let open = false;
  let handles = 0;
  const state = (): TransactionState => ({ mode, transactionOpen: open });
  const call = vi.fn((type: string, params: Record<string, unknown>): Promise<unknown> => {
    switch (type) {
      case "session.open": {
        const opened: OpenedSession = {
          sessionId: SESSION_ID,
          pluginName: "fake",
          capabilities: ["sql", "transactions"],
          serverVersion: "1",
        };
        return Promise.resolve(opened);
      }
      case "script.split":
        return Promise.resolve(split(String(params.text)));
      case "statement.execute": {
        const sql = String(params.sql);
        executed.push(sql);
        if (sql.includes("FAIL")) {
          return Promise.reject(
            new EngineRequestError({ code: "statementFailed", message: "syntax error", hint: "Fix the SQL." }),
          );
        }
        const verb = sql.split(/\s+/)[0]?.toUpperCase();
        if (verb === "BEGIN") open = true;
        else if (verb === "COMMIT" || verb === "ROLLBACK") open = false;
        else if (mode === "manual") open = true;
        const reads = verb === "SELECT";
        const result: ExecutedStatement = {
          handle: `h${String(++handles)}`,
          columns: reads ? [{ name: "n", type: "int4" }] : [],
          rowCount: reads ? 1 : 0,
          truncated: false,
          rowsAffected: reads ? null : 1,
          firstWindow: { offset: 0, rows: reads ? [[sql]] : [] },
          transactionOpen: open,
        };
        return Promise.resolve(result);
      }
      case "transaction.setMode":
        mode = params.mode as TransactionMode;
        return Promise.resolve(state());
      case "transaction.commit":
      case "transaction.rollback":
        open = false;
        return Promise.resolve(state());
      case "result.release":
        released.push(String(params.handle));
        return Promise.resolve(null);
      default:
        return Promise.resolve(null);
    }
  });
  const client = { call } as unknown as EngineClient;
  return { client, call, executed, released };
}

function harness(options: { confirm?: boolean } = {}) {
  const engine = fakeEngine();
  const confirmDestructive = vi.fn((_statements: readonly ClassifiedStatement[]) =>
    Promise.resolve(options.confirm ?? true),
  );
  const onDdl = vi.fn();
  let now = 0;
  const store = createConsolesStore({
    connect: () => Promise.resolve(engine.client),
    now: () => (now += 5),
    clock: () => 0,
    confirmDestructive,
    onDdl,
  });
  const session = () => {
    const current = store.getState().consoles.c1;
    if (current === undefined) throw new Error("console c1 is gone");
    return current;
  };
  const messages = () => session().output.map((entry) => entry.message);
  return { ...engine, store, confirmDestructive, onDdl, session, messages };
}

async function opened(sql: string, options: { confirm?: boolean } = {}) {
  const context = harness(options);
  await context.store.getState().open("c1", "pg", { sql });
  return context;
}

describe("console runs", () => {
  it("givenSecondStatementFails_whenBatchRuns_thenThirdSkippedAndLogged", async () => {
    const { store, executed, session, messages } = await opened("SELECT 1;\nSELECT FAIL;\nSELECT 3;");

    await store.getState().run("c1", "all");

    expect(executed).toEqual(["SELECT 1", "SELECT FAIL"]);
    expect(messages()).toEqual(["1 row retrieved in 5 ms", "syntax error", "1 statement skipped after the error."]);
    expect(session().output.map((entry) => entry.tone)).toEqual(["success", "error", "warning"]);
    expect(session().results.map((result) => result.title)).toEqual(["Result 1"]);
    expect(session().activeResult).toBe(OUTPUT_TAB);
    expect(session().lastRun?.outcome).toBe("failed");
    expect(session().status).toBe("ready");
  });

  it("givenDestructiveStatementCancelled_whenBatchRuns_thenNothingRuns", async () => {
    const { store, executed, confirmDestructive, messages, session } = await opened(
      "SELECT 1;\nDELETE FROM orders;\nDROP TABLE t;",
      { confirm: false },
    );

    await store.getState().run("c1", "all");

    expect(executed).toEqual([]);
    expect(confirmDestructive.mock.calls[0]?.[0].map((statement) => statement.destructive)).toEqual([
      "DELETE without WHERE",
      "DROP TABLE",
    ]);
    expect(messages()).toEqual(["Cancelled; nothing ran."]);
    expect(session().lastRun?.outcome).toBe("cancelled");
  });

  it("givenDestructiveStatementConfirmed_whenBatchRuns_thenAllRun", async () => {
    const { store, executed } = await opened("DELETE FROM orders;\nSELECT 1;");

    await store.getState().run("c1", "all");

    expect(executed).toEqual(["DELETE FROM orders", "SELECT 1"]);
  });

  it("givenCaretInSecondStatement_whenRun_thenOnlyItRunsAndIsFlashed", async () => {
    const sql = "SELECT 1;\nSELECT 2;\nSELECT 3;";
    const { store, executed, session } = await opened(sql);
    const caret = sql.indexOf("2");
    store.getState().setSelection("c1", { from: caret, to: caret });

    await store.getState().run("c1", "caret");

    expect(executed).toEqual(["SELECT 2"]);
    expect(session().flash).toMatchObject({ from: sql.indexOf("SELECT 2"), to: sql.indexOf("SELECT 2") + 8 });
  });

  it("givenSelectionInsideStatement_whenRun_thenSelectedTextRunsAtItsOffset", async () => {
    const sql = "SELECT 1 + 2 AS n;";
    const { store, executed, session } = await opened(sql);
    store.getState().setSelection("c1", { from: 0, to: "SELECT 1".length });

    await store.getState().run("c1", "caret");

    expect(executed).toEqual(["SELECT 1"]);
    expect(session().flash).toMatchObject({ from: 0, to: 8 });
  });

  it("givenEmptyConsole_whenRun_thenOutputSaysNothingToRun", async () => {
    const { store, executed, messages } = await opened("  \n;\n");
    await store.getState().run("c1", "caret");

    expect(executed).toEqual([]);
    expect(messages()).toEqual(["Nothing to run"]);
  });

  it("givenPinnedResult_whenRunAgain_thenPinnedKeptOthersReplacedAndReleased", async () => {
    const { store, session, released } = await opened("SELECT 1;\nSELECT 2;");
    await store.getState().run("c1", "all");
    const [first, second] = session().results;
    store.getState().togglePin("c1", first?.id ?? "");

    await store.getState().run("c1", "all");

    expect(session().results.map((result) => [result.title, result.pinned])).toEqual([
      ["Result 1", true],
      ["Result 2", false],
      ["Result 3", false],
    ]);
    expect(session().results[0]?.id).toBe(first?.id);
    expect(released).toEqual([second?.handle]);
    expect(session().activeResult).toBe(session().results[2]?.id);
  });

  it("givenDdlInAutoMode_whenRun_thenCatalogRefreshed", async () => {
    const { store, onDdl } = await opened("CREATE TABLE t (id int);");

    await store.getState().run("c1", "all");

    expect(onDdl).toHaveBeenCalledWith("pg");
  });

  it("givenDdlInManualMode_whenCommitted_thenCatalogRefreshedOnlyAfterCommit", async () => {
    const { store, onDdl, session, messages } = await opened("CREATE TABLE t (id int);");
    expect(await store.getState().setTransactionMode("c1", "manual")).toBe(true);

    await store.getState().run("c1", "all");
    expect(session().transactionOpen).toBe(true);
    expect(onDdl).not.toHaveBeenCalled();

    expect(await store.getState().commit("c1")).toBe(true);
    expect(session().transactionOpen).toBe(false);
    expect(onDdl).toHaveBeenCalledWith("pg");
    expect(messages().at(-1)).toBe("Committed");
  });

  it("givenDdlInManualMode_whenRolledBack_thenCatalogNotRefreshed", async () => {
    const { store, onDdl } = await opened("CREATE TABLE t (id int);");
    await store.getState().setTransactionMode("c1", "manual");
    await store.getState().run("c1", "all");

    await store.getState().rollback("c1");

    expect(onDdl).not.toHaveBeenCalled();
  });

  it("givenAutoMode_whenExplicitBegin_thenTransactionOpenUntilCommitStatement", async () => {
    const { store, session } = await opened("BEGIN;\nINSERT INTO t VALUES (1);");
    await store.getState().run("c1", "all");
    expect(session().transactionOpen).toBe(true);

    store.getState().setSql("c1", "COMMIT;");
    await store.getState().run("c1", "all");

    expect(session().transactionOpen).toBe(false);
  });

  it("givenManualModeBeforeConnecting_whenSessionOpens_thenModeApplied", async () => {
    const { store, call, session } = harness();
    await store.getState().open("c1", "pg", { sql: "INSERT INTO t VALUES (1);", connect: false });
    await store.getState().setTransactionMode("c1", "manual");

    await store.getState().run("c1", "all");

    expect(call).toHaveBeenCalledWith("transaction.setMode", { sessionId: SESSION_ID, mode: "manual" });
    expect(session().transactionOpen).toBe(true);
  });

  it("givenOpenTransaction_whenDetached_thenOutputWarnsAndNotOpen", async () => {
    const { store, session, messages } = await opened("BEGIN;");
    await store.getState().run("c1", "all");

    store.getState().detach("pg", null);

    expect(session().transactionOpen).toBe(false);
    expect(session().status).toBe("disconnected");
    expect(messages().at(-1)).toBe("The session closed; its open transaction was rolled back.");
  });
});

describe("output lines", () => {
  const NO_ROWS = { columns: [], rowCount: 0, truncated: false } as const;

  it("givenDdlWithDriversZeroAffected_whenFormatted_thenCompletedNotZeroRows", () => {
    expect(executedText({ ...NO_ROWS, rowsAffected: 0 }, 44, "ddl")).toBe("completed in 44 ms");
  });

  it("givenWrite_whenFormatted_thenRowsAffected", () => {
    expect(executedText({ ...NO_ROWS, rowsAffected: 1 }, 12, "write")).toBe("1 row affected in 12 ms");
  });

  it("givenTruncatedRead_whenFormatted_thenRowsRetrievedAndTruncated", () => {
    expect(executedText({ columns: [{}], rowCount: 3, truncated: true, rowsAffected: null }, 38, "read")).toBe(
      "3 rows retrieved (truncated) in 38 ms",
    );
  });
});
