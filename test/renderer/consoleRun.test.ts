import { describe, expect, it, vi } from "vitest";
import type {
  ClassifiedStatement,
  CurrentNamespace,
  ExecutedStatement,
  OpenedSession,
  StatementParameter,
  TransactionMode,
  TransactionState,
} from "@table-craft/desktop/engine/protocol.js";
import { EngineRequestError, type EngineClient } from "@table-craft/desktop/renderer/engine/client.js";
import { executedText, namespaceLabel, serviceState } from "@table-craft/desktop/renderer/model/format.js";
import {
  createConsolesStore,
  OUTPUT_TAB,
  type ConsoleSession,
  type ParametersRequest,
} from "@table-craft/desktop/renderer/state/consoles.js";
import { useSettings } from "@table-craft/desktop/renderer/state/settings.js";
import { createExecutionsStore } from "@table-craft/desktop/renderer/state/executions.js";
import { createHistoryClient } from "@table-craft/desktop/renderer/state/history.js";
import type { HistoryEntry } from "@table-craft/desktop/preload/bridge.js";

const SESSION_ID = "s1";
const ANSWER_AFTER_MS = 10_000;

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
      statements.push({ from, to: from + sql.length, sql, kind, destructive, parameters: fakeParameters(sql) });
    }
    start += piece.length + 1;
  }
  return statements;
}

const FAKE_PARAMETER = /:[A-Za-z_]\w*|\?/g;

/** `:name` and `?` anywhere, enough for the store; real detection is the plugin's. */
function fakeParameters(sql: string): StatementParameter[] {
  let positional = 0;
  return [...sql.matchAll(FAKE_PARAMETER)].map((match) => {
    const from = match.index;
    const to = from + match[0].length;
    return match[0] === "?"
      ? { name: `?${String(++positional)}`, from, to, style: "positional" as const }
      : { name: match[0], from, to, style: "named" as const };
  });
}

/** An engine with one session: `FAIL` in a statement fails it; BEGIN, COMMIT, ROLLBACK and manual mode move its transaction. */
function fakeEngine() {
  const executed: string[] = [];
  const bound: unknown[] = [];
  const released: string[] = [];
  let mode: TransactionMode = "auto";
  let open = false;
  let handles = 0;
  let namespace: CurrentNamespace = ["shop"];
  const state = (): TransactionState => ({ mode, transactionOpen: open, namespace });
  const call = vi.fn((type: string, params: Record<string, unknown>): Promise<unknown> => {
    switch (type) {
      case "session.open": {
        const opened: OpenedSession = {
          sessionId: SESSION_ID,
          pluginName: "fake",
          capabilities: ["sql", "transactions"],
          serverVersion: "1",
          namespace,
        };
        return Promise.resolve(opened);
      }
      case "script.split":
        return Promise.resolve(split(String(params.text)));
      case "statement.execute": {
        const sql = String(params.sql);
        executed.push(sql);
        bound.push(params.parameters);
        if (sql.includes("FAIL")) {
          return Promise.reject(
            new EngineRequestError({ code: "statementFailed", message: "syntax error", hint: "Fix the SQL." }),
          );
        }
        const verb = sql.split(/\s+/)[0]?.toUpperCase();
        const uses = verb === "USE";
        if (uses) namespace = [sql.split(/\s+/)[1] ?? ""];
        if (verb === "BEGIN") open = true;
        else if (verb === "COMMIT" || verb === "ROLLBACK") open = false;
        else if (mode === "manual") open = true;
        const reads = verb === "SELECT";
        const result: ExecutedStatement = {
          handle: `h${String(++handles)}`,
          columns: reads ? [{ name: "n", type: "int4" }] : [],
          typeClasses: reads ? ["integer"] : [],
          rowCount: reads ? 1 : 0,
          complete: true,
          cursorOpen: false,
          rowsAffected: reads ? null : 1,
          firstWindow: { offset: 0, rows: reads ? [[sql]] : [] },
          transactionOpen: open,
          ...(uses ? { namespace } : {}),
        };
        return Promise.resolve(result);
      }
      case "sql.format":
        return Promise.resolve(String(params.text).replace(/\s+(FROM|WHERE)\b/g, "\n$1"));
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
  /** Moves the session's namespace behind the console's back, as a rolled-back `SET LOCAL` does. */
  const moveNamespace = (path: CurrentNamespace) => {
    namespace = path;
  };
  return { client, call, executed, bound, released, moveNamespace };
}

function harness(
  options: {
    confirm?: boolean;
    record?: (entry: HistoryEntry) => void;
    values?: Readonly<Record<string, string | null>> | null;
  } = {},
) {
  const engine = fakeEngine();
  const confirmDestructive = vi.fn((_statements: readonly ClassifiedStatement[]) =>
    Promise.resolve(options.confirm ?? true),
  );
  const askParameters = vi.fn((_request: ParametersRequest) =>
    Promise.resolve(options.values === undefined ? {} : options.values),
  );
  const onDdl = vi.fn();
  const recorded: HistoryEntry[] = [];
  const executions = createExecutionsStore();
  let now = 0;
  const store = createConsolesStore({
    connect: () => Promise.resolve(engine.client),
    now: () => (now += 5),
    clock: () => 0,
    confirmDestructive,
    askParameters,
    onDdl,
    executions: executions.getState(),
    record: options.record ?? ((entry) => recorded.push(entry)),
  });
  const session = () => {
    const current = store.getState().consoles.c1;
    if (current === undefined) throw new Error("console c1 is gone");
    return current;
  };
  const messages = () => session().output.map((entry) => entry.message);
  return { ...engine, store, confirmDestructive, askParameters, onDdl, session, messages, recorded, executions };
}

async function opened(sql: string, options: Parameters<typeof harness>[0] = {}) {
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

  it("givenDestructiveConfirmOpen_whenStatusRead_thenWaitingForConfirmation", async () => {
    const engine = fakeEngine();
    let now = 0;
    const asked: (ConsoleSession | undefined)[] = [];
    const store = createConsolesStore({
      connect: () => Promise.resolve(engine.client),
      now: () => now,
      clock: () => 0,
      confirmDestructive: () => {
        asked.push(store.getState().consoles.c1);
        now += ANSWER_AFTER_MS;
        return Promise.resolve(true);
      },
    });
    await store.getState().open("c1", "pg", { sql: "DROP TABLE t" });

    await store.getState().run("c1", "all");

    expect(asked.map((session) => session?.status)).toEqual(["confirming"]);
    expect(asked.map((session) => (session === undefined ? null : serviceState(session)))).toEqual(["waiting"]);
    // The time spent answering is not the run's.
    expect(store.getState().consoles.c1?.lastRun).toEqual({ durationMs: 0, outcome: "succeeded" });
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
    expect(released).toEqual([second?.kind === "rows" ? second.handle : null]);
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

describe("console namespace", () => {
  it("givenSessionOpened_whenNamespaceReported_thenConsoleRecordsIt", async () => {
    const { session } = await opened("SELECT 1;");

    expect(session().namespace).toEqual(["shop"]);
  });

  it("givenUseExecuted_whenNamespaceReported_thenConsoleUpdates", async () => {
    const { store, session } = await opened("USE archive;\nSELECT 1;");

    await store.getState().run("c1", "all");

    expect(session().namespace).toEqual(["archive"]);
  });

  it("givenStatementWithoutNamespace_whenExecuted_thenKept", async () => {
    const { store, session, moveNamespace } = await opened("SELECT 1;");
    moveNamespace(["elsewhere"]);

    await store.getState().run("c1", "all");

    expect(session().namespace).toEqual(["shop"]);
  });

  it("givenFailedUse_whenExecuted_thenNamespaceUnchanged", async () => {
    const { store, session } = await opened("USE FAIL;");

    await store.getState().run("c1", "all");

    expect(session().namespace).toEqual(["shop"]);
  });

  it("givenRollbackWithNamespace_whenTransacted_thenConsoleUpdates", async () => {
    const { store, session, moveNamespace } = await opened("BEGIN;");
    await store.getState().run("c1", "all");
    moveNamespace(["reverted"]);

    await store.getState().rollback("c1");

    expect(session().namespace).toEqual(["reverted"]);
  });

  it("givenNamespace_whenDetached_thenForgotten", async () => {
    const { store, session } = await opened("USE archive;");
    await store.getState().run("c1", "all");

    store.getState().detach("pg", null);

    expect(session().namespace).toBeNull();
  });

  it("givenReconnect_whenSessionReopens_thenNamespaceIsTheNewSessions", async () => {
    const { store, session, moveNamespace } = await opened("USE archive;");
    await store.getState().run("c1", "all");
    store.getState().detach("pg", null);
    moveNamespace(["shop"]);

    store.getState().setSql("c1", "SELECT 1;");
    await store.getState().run("c1", "all");

    expect(session().namespace).toEqual(["shop"]);
  });

  it("givenSchemaPath_whenLabelled_thenSchemaWithFullPathAsTitle", () => {
    expect(namespaceLabel(["table_craft", "archive"])).toEqual({ text: "archive", title: "table_craft.archive" });
  });

  it("givenNoNamespace_whenLabelled_thenHidden", () => {
    expect(namespaceLabel(null)).toBeNull();
    expect(namespaceLabel([])).toBeNull();
  });
});

describe("output lines", () => {
  const NO_ROWS = { columns: [], rowCount: 0, complete: true } as const;

  it("givenDdlWithDriversZeroAffected_whenFormatted_thenCompletedNotZeroRows", () => {
    expect(executedText({ ...NO_ROWS, rowsAffected: 0 }, 44, "ddl")).toBe("completed in 44 ms");
  });

  it("givenWrite_whenFormatted_thenRowsAffected", () => {
    expect(executedText({ ...NO_ROWS, rowsAffected: 1 }, 12, "write")).toBe("1 row affected in 12 ms");
  });

  it("givenCompleteRead_whenFormatted_thenRowsRetrieved", () => {
    expect(executedText({ columns: [{}], rowCount: 3, complete: true, rowsAffected: null }, 38, "read")).toBe(
      "3 rows retrieved in 38 ms",
    );
  });

  it("givenFirstPageOfMore_whenFormatted_thenCountWithPlus", () => {
    expect(executedText({ columns: [{}], rowCount: 500, complete: false, rowsAffected: null }, 38, "read")).toBe(
      "500+ rows retrieved in 38 ms",
    );
  });
});

describe("console history and executions", () => {
  it("givenScriptWithFailingSecondStatement_whenRun_thenFirstTwoRecordedThirdSkipped", async () => {
    const { store, recorded, executions } = await opened("SELECT 1;\nSELECT FAIL;\nSELECT 3;");

    await store.getState().run("c1", "all");

    expect(recorded).toEqual([
      {
        datasourceId: "pg",
        sql: "SELECT 1",
        startedAt: 0,
        durationMs: 5,
        outcome: "success",
        rowCount: 1,
        message: null,
        source: "console",
      },
      {
        datasourceId: "pg",
        sql: "SELECT FAIL",
        startedAt: 0,
        durationMs: 5,
        outcome: "error",
        rowCount: null,
        message: "syntax error",
        source: "console",
      },
    ]);
    expect(executions.getState().byTab.c1?.map((execution) => [execution.label, execution.outcome])).toEqual([
      ["SELECT FAIL", "error"],
      ["SELECT 1", "success"],
    ]);
  });

  it("givenWrite_whenRun_thenRowsAffectedRecorded", async () => {
    const { store, recorded } = await opened("UPDATE orders SET n = 1 WHERE id = 1;");

    await store.getState().run("c1", "all");

    expect(recorded.map((entry) => [entry.sql, entry.rowCount])).toEqual([["UPDATE orders SET n = 1 WHERE id = 1", 1]]);
  });

  it("givenDestructiveDeclined_whenRun_thenNothingRecorded", async () => {
    const { store, recorded, executions } = await opened("SELECT 1;\nDROP TABLE t;", { confirm: false });

    await store.getState().run("c1", "all");

    expect(recorded).toEqual([]);
    expect(executions.getState().byTab.c1 ?? []).toEqual([]);
  });

  it("givenEmptyConsole_whenRun_thenNothingRecorded", async () => {
    const { store, recorded } = await opened("  ");

    await store.getState().run("c1", "all");

    expect(recorded).toEqual([]);
  });

  it("givenEnvironmentDatasource_whenRun_thenNothingRecorded", async () => {
    const historyRecord = vi.fn(() => Promise.resolve({ ok: true as const, value: null }));
    const client = createHistoryClient({
      bridge: () => ({ historyRecord, historySearch: vi.fn(), historyClear: vi.fn() }),
      isEphemeral: (datasourceId) => datasourceId === "pg",
      log: vi.fn(),
    });
    const { store } = await opened("SELECT 1;", { record: client.record });

    await store.getState().run("c1", "all");

    expect(historyRecord).not.toHaveBeenCalled();
  });

  it("givenHistoryWriteFails_whenRun_thenRunSucceeds", async () => {
    const log = vi.fn();
    const client = createHistoryClient({
      bridge: () => ({
        historyRecord: vi.fn(() => Promise.reject(new Error("disk full"))),
        historySearch: vi.fn(),
        historyClear: vi.fn(),
      }),
      isEphemeral: () => false,
      log,
    });
    const { store, session, executed } = await opened("SELECT 1;\nSELECT 2;", { record: client.record });

    await store.getState().run("c1", "all");
    await Promise.resolve();

    expect(executed).toEqual(["SELECT 1", "SELECT 2"]);
    expect(session().lastRun?.outcome).toBe("succeeded");
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("givenText_whenInserted_thenOneShotUntilAcknowledged", async () => {
    const { store, session } = await opened("SELECT 1;");

    store.getState().insert("c1", "SELECT 2;");
    const insertion = session().insertion;
    store.getState().inserted("c1", insertion?.seq ?? -1);

    expect(insertion?.text).toBe("SELECT 2;");
    expect(session().insertion).toBeNull();
  });
});

describe("query parameters", () => {
  it("givenParameters_whenRun_thenPromptsAndSendsValues", async () => {
    const { store, executed, bound, askParameters, recorded } = await opened(
      "SELECT * FROM t WHERE id = :id;\nSELECT ?, ?;\nSELECT ? AND :id;",
      { values: { ":id": "7", "?1": "a", "?2": null, "?3": "c" } },
    );

    await store.getState().run("c1", "all");

    expect(askParameters.mock.calls[0]?.[0].prompt.names).toEqual([":id", "?1", "?2", "?3"]);
    expect(executed).toHaveLength(3);
    expect(bound).toEqual([{ ":id": "7" }, { "?1": "a", "?2": null }, { "?1": "c", ":id": "7" }]);
    expect(recorded.map((entry) => entry.parameters)).toEqual(bound);
    expect(store.getState().consoles.c1?.parameterValues).toEqual({ ":id": "7", "?1": "a", "?2": null, "?3": "c" });
  });

  it("givenRememberedValues_whenRunAgain_thenPromptPrefilled", async () => {
    const { store, askParameters } = await opened("SELECT :id", { values: { ":id": "7" } });

    await store.getState().run("c1", "all");
    await store.getState().run("c1", "all");

    expect(askParameters.mock.calls[1]?.[0].initial).toEqual({ ":id": "7" });
  });

  it("givenPromptCancelled_whenRun_thenNothingRuns", async () => {
    const { store, executed, messages, session, recorded } = await opened("SELECT :id", { values: null });

    await store.getState().run("c1", "all");

    expect(executed).toEqual([]);
    expect(recorded).toEqual([]);
    expect(messages()).toEqual(["Cancelled; nothing ran."]);
    expect(session().lastRun?.outcome).toBe("cancelled");
  });

  it("givenDestructiveDeclined_whenRun_thenParametersNeverAsked", async () => {
    const { store, askParameters } = await opened("DELETE FROM t WHERE id = :id; DROP TABLE t", { confirm: false });

    await store.getState().run("c1", "all");

    expect(askParameters).not.toHaveBeenCalled();
  });

  it("givenNoParameters_whenRun_thenNeitherAskedNorSent", async () => {
    const { store, askParameters, bound } = await opened("SELECT 1");

    await store.getState().run("c1", "all");

    expect(askParameters).not.toHaveBeenCalled();
    expect(bound).toEqual([undefined]);
  });

  it("givenDetectionOff_whenRun_thenRunsVerbatim", async () => {
    const settings = useSettings.getState().settings;
    useSettings.setState({ settings: { ...settings, console: { parameters: false } } });
    try {
      const { store, askParameters, bound, executed } = await opened("SELECT :id");

      await store.getState().run("c1", "all");

      expect(askParameters).not.toHaveBeenCalled();
      expect(executed).toEqual(["SELECT :id"]);
      expect(bound).toEqual([undefined]);
    } finally {
      useSettings.setState({ settings });
    }
  });

  it("givenResultWithParameters_whenRerun_thenPromptsAndSendsValues", async () => {
    const { store, bound, askParameters, session } = await opened("SELECT :id", { values: { ":id": "7" } });
    await store.getState().run("c1", "all");
    const resultId = session().results[0]?.id ?? "";

    await store.getState().rerun("c1", resultId);

    expect(askParameters).toHaveBeenCalledTimes(2);
    expect(bound).toEqual([{ ":id": "7" }, { ":id": "7" }]);
  });

  it("givenHistoryValues_whenInserted_thenRememberedForTheNextPrompt", async () => {
    const { store } = await opened("");

    store.getState().insert("c1", "SELECT :id", { ":id": "42" });

    expect(store.getState().consoles.c1?.parameterValues).toEqual({ ":id": "42" });
  });
});

describe("reformat", () => {
  it("givenNoSelection_whenReformatted_thenWholeConsoleReplacedCaretOnToken", async () => {
    const { store } = await opened("SELECT a FROM t WHERE b");
    store.getState().setSelection("c1", { from: 9, to: 9 });

    await store.getState().reformat("c1");

    const replacement = store.getState().consoles.c1?.replacement;
    expect(replacement).toMatchObject({ from: 0, to: 23, text: "SELECT a\nFROM t\nWHERE b" });
    expect(replacement?.selection).toEqual({ from: 9, to: 9 });
  });

  it("givenSelection_whenReformatted_thenOnlySelectionReplaced", async () => {
    const { store } = await opened("SELECT 1;\nSELECT a FROM t;");
    store.getState().setSelection("c1", { from: 10, to: 25 });

    await store.getState().reformat("c1");

    expect(store.getState().consoles.c1?.replacement).toMatchObject({
      from: 10,
      to: 25,
      before: "SELECT a FROM t",
      text: "SELECT a\nFROM t",
      selection: { from: 10, to: 25 },
    });
  });

  it("givenFormatFails_whenReformatted_thenTextKeptAndOutputSaysWhy", async () => {
    const { store, call, messages } = await opened("SELECT (");
    call.mockImplementationOnce(() =>
      Promise.reject(new EngineRequestError({ code: "formatFailed", message: "Parse error at line 1", hint: "h" })),
    );

    await store.getState().reformat("c1");

    expect(store.getState().consoles.c1?.replacement).toBeNull();
    expect(messages()).toEqual(["Could not reformat: Parse error at line 1"]);
  });

  it("givenReplacementApplied_whenAcknowledged_thenCleared", async () => {
    const { store } = await opened("SELECT a FROM t");
    await store.getState().reformat("c1");
    const seq = store.getState().consoles.c1?.replacement?.seq ?? -1;

    store.getState().replaced("c1", seq);

    expect(store.getState().consoles.c1?.replacement).toBeNull();
  });
});
