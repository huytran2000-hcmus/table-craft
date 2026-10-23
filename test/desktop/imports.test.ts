import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CSV_FORMAT, type PluginLoadResult } from "@table-craft/core";
import sqlite from "@table-craft/plugin-sqlite";
import type { EngineResponse, ImportPreview } from "@table-craft/desktop/engine/protocol.js";
import {
  execute,
  exportHarness,
  openSession,
  resultOf,
  startImport as start,
  type ExportHarness,
} from "../support/engineExports.js";
import { SQLITE_MANIFEST } from "../support/manifests.js";
import { seededSqliteFile } from "../support/sqliteFixture.js";

const LOADED_SQLITE: PluginLoadResult = {
  status: "loaded",
  directory: "plugins/sqlite",
  manifest: SQLITE_MANIFEST,
  plugin: sqlite,
};
const MAIN = ["main"];
const CUSTOMERS_MAPPING = [
  { column: "id", field: 0 },
  { column: "name", field: 1 },
  { column: "email", field: 2 },
];
const ALL = { mode: "all" } as const;
const STOP = { mode: "stop" } as const;

function harness(path: string, readOnly = false): ExportHarness {
  return exportHarness({ id: "import", pluginId: "sqlite", config: { path }, readOnly, keepAliveSeconds: 0 }, [
    LOADED_SQLITE,
  ]);
}

function customerLines(from: number, to: number): string {
  let text = "";
  for (let id = from; id <= to; id += 1) text += `${String(id)},Name ${String(id)},n${String(id)}@example.com\n`;
  return text;
}

function failure(response: EngineResponse): string {
  if (response.type !== "engine.error") throw new Error("expected an engine error");
  return response.error.message;
}

describe("engine imports", () => {
  const cleanup: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const step of cleanup.splice(0).reverse()) await step();
  });

  async function file(name: string, text: string): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "table-craft-import-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, name);
    await writeFile(path, text);
    return path;
  }

  function open(path: string, readOnly = false): ExportHarness {
    const opened = harness(path, readOnly);
    cleanup.push(() => opened.close());
    return opened;
  }

  async function rows(harnessed: ExportHarness, sql: string): Promise<readonly unknown[]> {
    const sessionId = await openSession(harnessed.connection);
    return (await execute(harnessed.connection, sessionId, sql)).firstWindow.rows;
  }

  it("givenCsv_whenImportedIntoExistingTable_thenRowsCommitted", async () => {
    const source = await file("customers.csv", `id,name,email\n${customerLines(3, 1_502)}`);
    const opened = open(seededSqliteFile());

    const task = await start(opened.connection, {
      file: source,
      format: CSV_FORMAT,
      target: { kind: "table", path: MAIN, relation: "customers", mapping: CUSTOMERS_MAPPING },
      transaction: ALL,
      errors: STOP,
    });
    const done = await opened.imported(task.taskId);

    expect(done).toMatchObject({ state: "done", written: 1_500, committed: 1_500, rejected: 0, created: false });
    expect(done.bytes).toBe(done.size);
    expect(await rows(opened, "SELECT COUNT(*), MAX(id) FROM customers")).toEqual([[1_502, 1_502]]);
  });

  it("givenFile_whenPreviewed_thenNamesRowsKindsAndPluginTypes", async () => {
    const source = await file("people.csv", 'id,born,score,note\n1,2024-02-29,1.5,\n2,1999-12-31,20,"x, y"\n');
    const opened = open(seededSqliteFile());

    const preview = resultOf<ImportPreview>(
      await opened.connection.handle({ id: 9, type: "import.preview", file: source, format: CSV_FORMAT }),
    );

    expect(preview).toMatchObject({
      names: ["id", "born", "score", "note"],
      rows: [
        ["1", "2024-02-29", "1.5", null],
        ["2", "1999-12-31", "20", "x, y"],
      ],
      kinds: ["integer", "date", "decimal", "text"],
      types: ["INTEGER", "DATE", "NUMERIC", "TEXT"],
      ragged: 0,
    });
  });

  it("givenNewTarget_whenStarted_thenPluginDdlCreatesTableAndRowsArrive", async () => {
    const source = await file("people.csv", "id,label\n1,one\n2,two\n");
    const opened = open(seededSqliteFile());
    const columns = [
      { name: "id", type: "INTEGER", field: 0 },
      { name: "label", type: "TEXT", field: 1 },
    ];

    const ddl = resultOf<string>(
      await opened.connection.handle({ id: 9, type: "import.ddl", path: MAIN, relation: "people", columns }),
    );
    const task = await start(opened.connection, {
      file: source,
      format: CSV_FORMAT,
      target: { kind: "new", path: MAIN, relation: "people", columns },
      transaction: ALL,
      errors: STOP,
    });
    const done = await opened.imported(task.taskId);

    expect(ddl).toMatch(/^CREATE TABLE "main"\."people" \(/u);
    expect(done).toMatchObject({ state: "done", committed: 2, created: true });
    expect(await rows(opened, "SELECT id, label FROM people ORDER BY id")).toEqual([
      [1, "one"],
      [2, "two"],
    ]);
  });

  it("givenStopPolicy_whenRowRefused_thenFailedWithLineAndNothingKept", async () => {
    const source = await file("customers.csv", `id,name,email\n${customerLines(3, 10)}11,dup,n3@example.com\n`);
    const opened = open(seededSqliteFile());

    const task = await start(opened.connection, {
      file: source,
      format: CSV_FORMAT,
      target: { kind: "table", path: MAIN, relation: "customers", mapping: CUSTOMERS_MAPPING },
      transaction: ALL,
      errors: STOP,
    });
    const done = await opened.imported(task.taskId);

    expect(done.state).toBe("failed");
    expect(done.error?.reason).toBe("badRow");
    expect(done.error?.message).toMatch(/^Row 9 \(line 10\): .*UNIQUE.*\. Nothing was imported/su);
    expect(done.committed).toBe(0);
    expect(await rows(opened, "SELECT COUNT(*) FROM customers")).toEqual([[2]]);
  });

  it("givenSkipPolicy_whenRowsBad_thenRestImportedAndRejectedFileBesideSource", async () => {
    const text = `id,name,email\n3,a,a@x\n4,ragged\n5,dup,ada@example.com\n6,b,b@x\n`;
    const source = await file("customers.csv", text);
    const opened = open(seededSqliteFile());

    const task = await start(opened.connection, {
      file: source,
      format: CSV_FORMAT,
      target: { kind: "table", path: MAIN, relation: "customers", mapping: CUSTOMERS_MAPPING },
      transaction: ALL,
      errors: { mode: "skip", limit: 10 },
    });
    const done = await opened.imported(task.taskId);
    const rejected = await readFile(`${source}.rejected.csv`, "utf8");

    expect(done).toMatchObject({ state: "done", committed: 2, rejected: 2, rejectedFile: `${source}.rejected.csv` });
    expect(rejected.split("\n")[0]).toBe("id,name,email,rejected_line,rejected_reason");
    expect(rejected).toMatch(/^4,ragged,3,it has 2 fields; the header has 3$/mu);
    expect(rejected).toMatch(/^5,dup,ada@example.com,4,.*UNIQUE/mu);
    expect(await rows(opened, "SELECT id FROM customers ORDER BY id")).toEqual([[1], [2], [3], [6]]);
  });

  it("givenSkipPolicy_whenNothingRejected_thenNoRejectedFile", async () => {
    const source = await file("customers.csv", `id,name,email\n${customerLines(3, 4)}`);
    const opened = open(seededSqliteFile());

    const task = await start(opened.connection, {
      file: source,
      format: CSV_FORMAT,
      target: { kind: "table", path: MAIN, relation: "customers", mapping: CUSTOMERS_MAPPING },
      transaction: ALL,
      errors: { mode: "skip", limit: 10 },
    });
    const done = await opened.imported(task.taskId);

    expect(done).toMatchObject({ state: "done", rejectedFile: null });
    expect(existsSync(`${source}.rejected.csv`)).toBe(false);
  });

  it("givenCommitEvery_whenStoppedThenFixedAndResumed_thenEveryRowOnce", async () => {
    const good = customerLines(3, 12);
    const broken = good.replace("7,Name 7,n7@example.com", "7,Name 7,ada@example.com");
    const source = await file("customers.csv", `id,name,email\n${broken}`);
    const opened = open(seededSqliteFile());

    const task = await start(opened.connection, {
      file: source,
      format: CSV_FORMAT,
      target: { kind: "table", path: MAIN, relation: "customers", mapping: CUSTOMERS_MAPPING },
      transaction: { mode: "every", rows: 2 },
      errors: STOP,
    });
    const failed = await opened.imported(task.taskId);
    await writeFile(source, `id,name,email\n${good}`);
    const resumed = resultOf<{ taskId: string; resumeFrom: number }>(
      await opened.connection.handle({ id: 9, type: "import.resume", taskId: task.taskId, stallSeconds: 120 }),
    );
    const done = await opened.imported(resumed.taskId);

    expect(failed).toMatchObject({ state: "failed", committed: 4, resumeFrom: 5 });
    expect(failed.error?.message).toMatch(/4 rows are committed; resume from row 5\.$/u);
    expect(resumed.resumeFrom).toBe(5);
    expect(done).toMatchObject({ state: "done", committed: 6 });
    expect(await rows(opened, "SELECT COUNT(*), COUNT(DISTINCT id) FROM customers")).toEqual([[12, 12]]);
  });

  it("givenInMemoryDatabase_whenStarted_thenRefused", async () => {
    const source = await file("customers.csv", "id,name,email\n");
    const opened = open(":memory:");

    const response = await opened.connection.handle({
      id: 9,
      type: "import.start",
      file: source,
      format: CSV_FORMAT,
      target: { kind: "table", path: MAIN, relation: "customers", mapping: CUSTOMERS_MAPPING },
      transaction: ALL,
      errors: STOP,
      stallSeconds: 120,
    });

    expect(failure(response)).toMatch(/in-memory database cannot be imported into/u);
  });

  it("givenReadOnlyDatasource_whenStarted_thenRefused", async () => {
    const source = await file("customers.csv", "id,name,email\n");
    const opened = open(seededSqliteFile(), true);

    const response = await opened.connection.handle({
      id: 9,
      type: "import.start",
      file: source,
      format: CSV_FORMAT,
      target: { kind: "table", path: MAIN, relation: "customers", mapping: CUSTOMERS_MAPPING },
      transaction: ALL,
      errors: STOP,
      stallSeconds: 120,
    });

    expect(failure(response)).toMatch(/read-only/u);
  });

  it("givenMissingFile_whenPreviewed_thenSaysItCannotBeRead", async () => {
    const opened = open(seededSqliteFile());

    const response = await opened.connection.handle({
      id: 9,
      type: "import.preview",
      file: join(tmpdir(), "table-craft-no-such-file.csv"),
      format: CSV_FORMAT,
    });

    expect(failure(response)).toMatch(/^Cannot read .*table-craft-no-such-file\.csv/u);
  });
});
