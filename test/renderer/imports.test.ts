import { describe, expect, it } from "vitest";
import { CSV_FORMAT, TSV_FORMAT } from "@table-craft/core";
import type { EngineMethod, ImportTask, ResultOf } from "@table-craft/desktop/engine/protocol.js";
import type { EngineClient } from "@table-craft/desktop/renderer/engine/client.js";
import {
  CSV_PRESET,
  defaultMapping,
  mappingOf,
  newColumnDrafts,
  newColumnsOf,
  newColumnsProblem,
  positiveCount,
  presetFor,
  tableNameOf,
  TSV_PRESET,
} from "@table-craft/desktop/renderer/model/importForm.js";
import {
  importingText,
  importNotes,
  importPercent,
  importProgressText,
} from "@table-craft/desktop/renderer/model/importText.js";
import { IMPORTS_ROW_KEY, movedInTree, serviceRows } from "@table-craft/desktop/renderer/model/servicesTree.js";
import { createImportsStore, resumeLabel } from "@table-craft/desktop/renderer/state/imports.js";

const DATASOURCE = "pg";
const PATH = ["table_craft", "public"];

function taskOf(overrides: Partial<ImportTask> = {}): ImportTask {
  return {
    taskId: "import-1",
    file: "/tmp/in/people.csv",
    table: '"public"."people"',
    state: "running",
    transaction: { mode: "all" },
    bytes: 0,
    size: 1000,
    written: 0,
    committed: 0,
    rejected: 0,
    elapsedMs: 0,
    resumeFrom: 1,
    ambiguous: false,
    created: false,
    rejectedFile: null,
    error: null,
    ...overrides,
  };
}

interface Call {
  readonly type: string;
  readonly params: unknown;
}

function store(answer: (type: string) => unknown = () => taskOf()) {
  const calls: Call[] = [];
  const refreshed: (readonly string[])[] = [];
  const client: EngineClient = {
    call<M extends EngineMethod>(type: M, params: unknown): Promise<ResultOf<M>> {
      calls.push({ type, params });
      return Promise.resolve(answer(type) as ResultOf<M>);
    },
    fail: () => undefined,
    onEvent: () => () => undefined,
  };
  const imports = createImportsStore({
    client: () => Promise.resolve(client),
    stallSeconds: () => 90,
    refresh: (_datasourceId, path) => refreshed.push(path),
  });
  return { imports, calls, refreshed };
}

const REQUEST = {
  file: "/tmp/in/people.csv",
  format: CSV_PRESET,
  target: { kind: "table", path: PATH, relation: "people", mapping: [{ column: "id", field: 0 }] },
  transaction: { mode: "all" },
  errors: { mode: "stop" },
} as const;

describe("import form", () => {
  it("givenPresets_whenComparedWithCore_thenIdentical", () => {
    expect(CSV_PRESET).toEqual(CSV_FORMAT);
    expect(TSV_PRESET).toEqual(TSV_FORMAT);
  });

  it("givenFileName_whenChosen_thenPresetAndTableNameFollow", () => {
    expect(presetFor("/data/People.TSV")).toBe(TSV_PRESET);
    expect(presetFor("/data/people.csv")).toBe(CSV_PRESET);
    expect(tableNameOf("/data/people 2024.csv")).toBe("people 2024");
    expect(tableNameOf("C:\\data\\.hidden")).toBe(".hidden");
  });

  it("givenHeader_whenMapped_thenByNameIgnoringCaseElsePosition", () => {
    const preview = { names: ["Email", "ID", "extra"] };

    expect(defaultMapping(["id", "name", "email"], preview, true)).toEqual([1, null, 0]);
    expect(defaultMapping(["id", "name", "email", "more"], preview, false)).toEqual([0, 1, 2, null]);
    expect(mappingOf(["id", "name", "email"], [1, null, 0])).toEqual([
      { column: "id", field: 1 },
      { column: "email", field: 0 },
    ]);
  });

  it("givenDrafts_whenChecked_thenProblemsNamedAndExcludedFieldsKeepTheirIndex", () => {
    const drafts = newColumnDrafts({ names: ["id", "name", "ID"], types: ["integer", "text", "integer"] });

    expect(newColumnsProblem(newColumnsOf(drafts))).toBe("Two columns are named ID.");
    const kept = newColumnsOf(drafts.map((draft, index) => (index === 1 ? { ...draft, include: false } : draft)));
    expect(kept.map((column) => column.field)).toEqual([0, 2]);
    expect(newColumnsProblem(newColumnsOf(drafts.map((draft) => ({ ...draft, include: false }))))).toBe(
      "Include at least one column.",
    );
    expect(newColumnsProblem(newColumnsOf([{ include: true, name: "a", type: " " }]))).toBe(
      "Every included column needs a type.",
    );
  });

  it("givenTypedCount_whenParsed_thenOnlyPositiveWholeNumbers", () => {
    expect(positiveCount("10000")).toBe(10_000);
    expect(positiveCount("0")).toBeNull();
    expect(positiveCount("1.5")).toBeNull();
    expect(positiveCount("x")).toBeNull();
  });
});

describe("imports store", () => {
  it("givenStart_whenAnswered_thenListedWithTheStallSetting", async () => {
    const { imports, calls } = store();

    await imports.getState().start(DATASOURCE, REQUEST);

    expect(calls[0]).toMatchObject({ type: "import.start", params: { stallSeconds: 90, file: REQUEST.file } });
    expect(imports.getState().entries).toEqual([{ datasourceId: DATASOURCE, path: PATH, task: taskOf() }]);
  });

  it("givenStartedTask_whenItEnds_thenNamespaceReadAgain", async () => {
    const { imports, refreshed } = store();
    await imports.getState().start(DATASOURCE, REQUEST);

    imports.getState().received(DATASOURCE, { id: null, type: "import.done", task: taskOf({ state: "done" }) });

    expect(refreshed).toEqual([PATH]);
  });

  it("givenFinalEvent_whenLateProgressArrives_thenFinalStateKept", () => {
    const { imports } = store();
    const done = taskOf({ state: "done", written: 10 });

    imports.getState().received(DATASOURCE, { id: null, type: "import.done", task: done });
    imports.getState().received(DATASOURCE, { id: null, type: "import.progress", task: taskOf({ written: 5 }) });

    expect(imports.getState().entries[0]?.task).toEqual(done);
  });

  it("givenCommitEveryTask_whenEngineExits_thenFailedSayingWhatWasCommitted", () => {
    const { imports } = store();
    const task = taskOf({ transaction: { mode: "every", rows: 1000 }, committed: 3000, resumeFrom: 3001 });
    imports.getState().received(DATASOURCE, { id: null, type: "import.progress", task });

    imports.getState().detached(DATASOURCE, { code: "internal", message: "The engine exited.", hint: "Reconnect." });

    const failed = imports.getState().entries[0]?.task;
    expect(failed?.state).toBe("failed");
    expect(failed?.error?.message).toBe(
      "The engine exited. The server rolls back what was not committed when the connection goes. 3,000 rows were committed when it stopped.",
    );
    expect(failed === undefined ? null : resumeLabel(failed)).toBe("Resume");
  });

  it("givenFailedTask_whenResumed_thenReplacedByTheNewRunAndRunningTaskRefused", async () => {
    const { imports, calls } = store(() => taskOf({ taskId: "import-2" }));
    imports.getState().received(DATASOURCE, {
      id: null,
      type: "import.failed",
      task: taskOf({ state: "failed", resumeFrom: 1 }),
    });

    await imports.getState().resume("import-1");
    await expect(imports.getState().resume("import-2")).resolves.toBeNull();

    expect(calls).toEqual([{ type: "import.resume", params: { taskId: "import-1", stallSeconds: 90 } }]);
    expect(imports.getState().entries.map((entry) => entry.task.taskId)).toEqual(["import-2"]);
  });

  it("givenTasks_whenLabelled_thenResumeOnlyAfterACommit", () => {
    expect(resumeLabel(taskOf())).toBeNull();
    expect(resumeLabel(taskOf({ state: "done" }))).toBeNull();
    expect(resumeLabel(taskOf({ state: "cancelled" }))).toBe("Retry");
    expect(resumeLabel(taskOf({ state: "failed", resumeFrom: 5001 }))).toBe("Resume");
  });
});

describe("import text", () => {
  it("givenRunningTask_whenShown_thenRowsBytesAndPercent", () => {
    const task = taskOf({ written: 1234, bytes: 410, elapsedMs: 3200 });

    expect(importPercent(task)).toBe(41);
    expect(importProgressText(task)).toBe("1,234 rows · 410 bytes of 1,000 bytes · 3.2 s");
    expect(importingText([task])).toBe("Importing 1 · 41%");
    expect(importingText([task, task])).toBe("Importing 2");
  });

  it("givenEndedTasks_whenShown_thenImportedOrCommittedAndNotes", () => {
    expect(importProgressText(taskOf({ state: "done", written: 1, elapsedMs: 50 }))).toBe("1 row imported · 50 ms");
    const failed = taskOf({
      state: "failed",
      committed: 5000,
      rejected: 2,
      created: true,
      rejectedFile: "/tmp/in/people.csv.rejected.csv",
    });
    expect(importProgressText(failed)).toMatch(/^5,000 rows committed · /u);
    expect(importNotes(failed)).toEqual(["2 rows rejected into people.csv.rejected.csv", "the created table stays"]);
  });

  it("givenImports_whenServicesRowsBuilt_thenImportsNodeNewestFirstAndCollapsible", () => {
    const first = { datasourceId: DATASOURCE, path: PATH, task: taskOf() };
    const second = { datasourceId: DATASOURCE, path: PATH, task: taskOf({ taskId: "import-2" }) };

    const rows = serviceRows([], new Set(), [], [first, second]);

    expect(rows.map((row) => row.key)).toEqual([IMPORTS_ROW_KEY, "import:import-2", "import:import-1"]);
    expect(serviceRows([], new Set([IMPORTS_ROW_KEY]), [], [first])).toHaveLength(1);
    expect(movedInTree(rows, "import:import-1", new Set(), "ArrowLeft")?.selected).toBe(IMPORTS_ROW_KEY);
  });
});
