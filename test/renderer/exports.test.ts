import { describe, expect, it } from "vitest";
import type { EngineMethod, ExportTask, ResultOf } from "@table-craft/desktop/engine/protocol.js";
import { withExtension } from "@table-craft/desktop/renderer/actions/exportActions.js";
import type { EngineClient } from "@table-craft/desktop/renderer/engine/client.js";
import {
  exportingText,
  exportNotes,
  exportPercent,
  exportProgressText,
  fileNameOf,
} from "@table-craft/desktop/renderer/model/exportText.js";
import { EXPORTS_ROW_KEY, movedInTree, serviceRows } from "@table-craft/desktop/renderer/model/servicesTree.js";
import { createExportsStore } from "@table-craft/desktop/renderer/state/exports.js";

const DATASOURCE = "pg";

function taskOf(overrides: Partial<ExportTask> = {}): ExportTask {
  return {
    taskId: "export-1",
    path: "/tmp/out/orders.csv",
    format: "csv",
    origin: "rerun",
    state: "running",
    rows: 0,
    bytes: 0,
    elapsedMs: 0,
    estimate: null,
    sheets: 0,
    truncatedCells: 0,
    clippedBytes: 0,
    warning: null,
    error: null,
    retryable: true,
    drains: null,
    ...overrides,
  };
}

interface Call {
  readonly type: string;
  readonly params: unknown;
}

function fakeClient(answer: (type: string) => unknown): { client: EngineClient; calls: Call[] } {
  const calls: Call[] = [];
  const client: EngineClient = {
    call<M extends EngineMethod>(type: M, params: unknown): Promise<ResultOf<M>> {
      calls.push({ type, params });
      return Promise.resolve(answer(type) as ResultOf<M>);
    },
    fail: () => undefined,
    onEvent: () => () => undefined,
  };
  return { client, calls };
}

function store(answer: (type: string) => unknown = () => taskOf()) {
  const { client, calls } = fakeClient(answer);
  const exports = createExportsStore({ client: () => Promise.resolve(client), stallSeconds: () => 90 });
  return { exports, calls };
}

describe("exports store", () => {
  it("givenStart_whenAnswered_thenListedWithTheStallSetting", async () => {
    const { exports, calls } = store();

    await exports.getState().start(DATASOURCE, {
      source: { kind: "result", handle: "r1", columns: [0] },
      format: "csv",
      path: "/tmp/out/orders.csv",
    });

    expect(calls[0]).toMatchObject({ type: "export.start", params: { stallSeconds: 90, format: "csv" } });
    expect(exports.getState().entries).toEqual([{ datasourceId: DATASOURCE, task: taskOf() }]);
  });

  it("givenFinalEvent_whenLateProgressArrives_thenFinalStateKept", () => {
    const { exports } = store();
    const done = taskOf({ state: "done", rows: 10 });

    exports.getState().received(DATASOURCE, { id: null, type: "export.done", task: done });
    exports.getState().received(DATASOURCE, { id: null, type: "export.progress", task: taskOf({ rows: 5 }) });

    expect(exports.getState().entries[0]?.task).toEqual(done);
  });

  it("givenRunningTask_whenFinishedEventArrives_thenWaiterResolves", async () => {
    const { exports } = store();
    exports.getState().received(DATASOURCE, { id: null, type: "export.progress", task: taskOf({ rows: 5 }) });
    const finished = exports.getState().finished("export-1");

    exports.getState().received(DATASOURCE, { id: null, type: "export.failed", task: taskOf({ state: "failed" }) });

    await expect(finished).resolves.toMatchObject({ state: "failed" });
  });

  it("givenRunningTask_whenEngineExits_thenFailedSayingNoFileWritten", () => {
    const { exports } = store();
    exports.getState().received(DATASOURCE, { id: null, type: "export.progress", task: taskOf() });

    exports.getState().detached(DATASOURCE, { code: "internal", message: "The engine exited.", hint: "Reconnect." });

    const { task } = exports.getState().entries[0] ?? {};
    expect(task?.state).toBe("failed");
    expect(task?.error?.message).toBe("The engine exited. The export stopped and no file was written.");
  });

  it("givenRunningTask_whenDisconnected_thenCancelled", () => {
    const { exports } = store();
    exports.getState().received(DATASOURCE, { id: null, type: "export.progress", task: taskOf() });

    exports.getState().detached(DATASOURCE, null);

    expect(exports.getState().entries[0]?.task.state).toBe("cancelled");
  });

  it("givenNonRetryableTask_whenRetried_thenNoCall", async () => {
    const { exports, calls } = store();
    exports.getState().received(DATASOURCE, {
      id: null,
      type: "export.failed",
      task: taskOf({ state: "failed", retryable: false }),
    });

    await expect(exports.getState().retry("export-1")).resolves.toBeNull();
    expect(calls).toEqual([]);
  });

  it("givenRunningTask_whenDismissed_thenKept", () => {
    const { exports } = store();
    exports.getState().received(DATASOURCE, { id: null, type: "export.progress", task: taskOf() });

    exports.getState().dismiss("export-1");

    expect(exports.getState().entries).toHaveLength(1);
  });
});

describe("export text", () => {
  it("givenEstimate_whenRunning_thenRowsOfEstimateAndPercent", () => {
    const task = taskOf({ rows: 12_345, estimate: 50_000, bytes: 4_300_000, elapsedMs: 3_200 });

    expect(exportProgressText(task)).toBe("12,345 of 50,000 rows · 4.1 MB · 3.2 s");
    expect(exportPercent(task)).toBe(24);
    expect(exportingText([task])).toBe("Exporting 1 · 24%");
    expect(exportingText([task, task])).toBe("Exporting 2");
  });

  it("givenDoneTask_whenDescribed_thenNotesSayWhatWasCut", () => {
    const task = taskOf({
      state: "done",
      rows: 1,
      sheets: 2,
      truncatedCells: 3,
      clippedBytes: 4,
      warning: "Low disk.",
    });

    expect(exportProgressText(task)).toBe("1 row · 0 bytes · 0 ms");
    expect(exportNotes(task)).toEqual([
      "Low disk.",
      "2 sheets",
      "3 cells cut to the format's limit",
      "4 binary values exported as previews; export the table for full values",
    ]);
    expect(fileNameOf("C:\\exports\\orders.xlsx")).toBe("orders.xlsx");
  });

  it("givenPathWithKnownExtension_whenFormatChanges_thenExtensionSwapped", () => {
    expect(withExtension("/tmp/orders.csv", "xlsx")).toBe("/tmp/orders.xlsx");
    expect(withExtension("/tmp/orders", "json")).toBe("/tmp/orders.json");
  });
});

describe("services exports node", () => {
  const entries = [
    { datasourceId: DATASOURCE, task: taskOf({ taskId: "a" }) },
    { datasourceId: DATASOURCE, task: taskOf({ taskId: "b", state: "done" }) },
  ];

  it("givenExports_whenRowsBuilt_thenNodeAfterDatasourcesNewestFirst", () => {
    const rows = serviceRows([], new Set(), entries);

    expect(rows.map((row) => row.key)).toEqual([EXPORTS_ROW_KEY, "export:b", "export:a"]);
  });

  it("givenCollapsedNode_whenRowsBuilt_thenOnlyTheNode", () => {
    expect(serviceRows([], new Set([EXPORTS_ROW_KEY]), entries)).toHaveLength(1);
  });

  it("givenExportLine_whenArrowLeft_thenParentSelected", () => {
    const rows = serviceRows([], new Set(), entries);

    expect(movedInTree(rows, "export:a", new Set(), "ArrowLeft")?.selected).toBe(EXPORTS_ROW_KEY);
  });
});
