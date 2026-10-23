import { describe, expect, it } from "vitest";
import type { PluginLoadResult } from "@table-craft/core";
import sqlite from "@table-craft/plugin-sqlite";
import { createEngine } from "@table-craft/desktop/engine/engine.js";
import { RESULT_FETCH_ALL_CAP, RESULT_PAGE_ROWS } from "@table-craft/desktop/engine/protocol.js";
import { connectionTarget } from "@table-craft/desktop/engine/requestLog.js";
import { createLogger, type LogRecord } from "@table-craft/desktop/log/record.js";
import { SQLITE_MANIFEST } from "../support/manifests.js";

const PAGING = { pageRows: RESULT_PAGE_ROWS, fetchAllCap: RESULT_FETCH_ALL_CAP };
const LOADED_SQLITE: PluginLoadResult = {
  status: "loaded",
  directory: "plugins/sqlite",
  manifest: SQLITE_MANIFEST,
  plugin: sqlite,
};
const SECRET_TEXT = "SELECT 'a row value nobody may log' AS v";

async function loggedSession() {
  const records: LogRecord[] = [];
  const connection = createEngine(
    {
      datasource: { id: "scratch", pluginId: "sqlite", config: { path: ":memory:" }, readOnly: false },
      plugins: [LOADED_SQLITE],
      log: createLogger({ process: "engine", scope: "engine", sink: (record) => records.push(record) }),
    },
    () => 0,
  ).connect();
  const opened = (await connection.handle({ id: 1, type: "session.open" })) as { result: { sessionId: string } };
  return { connection, records, sessionId: opened.result.sessionId };
}

describe("engine request log", () => {
  it("givenStatement_whenExecuted_thenLoggedWithoutText", async () => {
    const { connection, records, sessionId } = await loggedSession();

    await connection.handle({ id: 7, type: "statement.execute", sessionId, sql: SECRET_TEXT, ...PAGING });

    const finished = records.find((record) => record.msg === "statement finished");
    expect(finished).toMatchObject({
      level: "info",
      scope: "query",
      requestId: 7,
      kind: "read",
      rowCount: 1,
      elapsedMs: 0,
    });
    expect(records.find((record) => record.msg === "connected")).toMatchObject({
      scope: "connection",
      path: ":memory:",
    });
    expect(JSON.stringify(records)).not.toContain("row value");
    expect(records.filter((record) => record.level === "debug").map((record) => record.type)).toEqual([
      "session.open",
      "statement.execute",
    ]);
  });

  it("givenFailedRequest_whenHandled_thenWarnWithRequestIdAndCause", async () => {
    const { connection, records, sessionId } = await loggedSession();

    await connection.handle({ id: 9, type: "statement.execute", sessionId, sql: "SELEC nonsense", ...PAGING });

    const failed = records.find((record) => record.msg === "statement failed");
    expect(failed).toMatchObject({ level: "warn", requestId: 9, code: "statementFailed" });
    expect(failed?.err?.cause?.message).toContain("syntax error");
    expect(JSON.stringify(failed)).not.toContain('nonsense"');
  });

  it("givenManifestFields_whenTarget_thenSecretsAndUserDropped", () => {
    const target = connectionTarget(
      [
        { key: "host", label: "Host", kind: "text" },
        { key: "user", label: "User", kind: "text" },
        { key: "password", label: "Password", kind: "password", secret: true },
        { key: "token", label: "Token", kind: "text", secret: true },
      ],
      { host: "db", user: "admin", password: "pw", token: "t" },
    );

    expect(target).toEqual({ host: "db" });
  });
});
