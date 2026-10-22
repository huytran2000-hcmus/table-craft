import { describe, expect, it } from "vitest";
import { createExecutionsStore, EXECUTIONS_PER_SESSION } from "@table-craft/desktop/renderer/state/executions.js";
import { createTabsStore } from "@table-craft/desktop/renderer/state/tabs.js";
import { dropClosedExecutions } from "@table-craft/desktop/renderer/state/wiring.js";

const START = { label: "SELECT 1", sql: "SELECT 1", startedAt: 0 };
const SUCCESS = { durationMs: 3, outcome: "success", rowCount: 1, message: null } as const;

describe("executions", () => {
  it("givenStarted_whenFinished_thenRunningBecomesOutcome", () => {
    const store = createExecutionsStore();

    const id = store.getState().start("c1", START);
    expect(store.getState().byTab.c1?.[0]).toMatchObject({ id, outcome: "running", durationMs: null });
    store.getState().finish("c1", id, SUCCESS);

    expect(store.getState().byTab.c1?.[0]).toMatchObject({ id, outcome: "success", durationMs: 3, rowCount: 1 });
  });

  it("givenMoreThanFiftyExecutions_whenReported_thenOldestDropped", () => {
    const store = createExecutionsStore();

    for (let index = 0; index < EXECUTIONS_PER_SESSION + 2; index += 1) {
      store.getState().start("c1", { ...START, label: `SELECT ${String(index)}` });
    }

    const kept = store.getState().byTab.c1 ?? [];
    expect(kept).toHaveLength(EXECUTIONS_PER_SESSION);
    expect(kept[0]?.label).toBe(`SELECT ${String(EXECUTIONS_PER_SESSION + 1)}`);
    expect(kept.at(-1)?.label).toBe("SELECT 2");
  });

  it("givenExecutionDroppedWhileRunning_whenFinished_thenIgnored", () => {
    const store = createExecutionsStore(1);
    const first = store.getState().start("c1", START);
    store.getState().start("c1", START);

    store.getState().finish("c1", first, SUCCESS);

    expect(store.getState().byTab.c1?.map((execution) => execution.outcome)).toEqual(["running"]);
  });

  it("givenExecutions_whenCleared_thenTabKeptEmpty", () => {
    const store = createExecutionsStore();
    store.getState().start("c1", START);

    store.getState().clear("c1");

    expect(store.getState().byTab.c1).toEqual([]);
  });

  it("givenTabClosed_whenReading_thenItsExecutionsGone", () => {
    const tabs = createTabsStore();
    const executions = createExecutionsStore();
    const unwire = dropClosedExecutions(tabs, executions);
    tabs.getState().open({ id: "c1", kind: "console", title: "console" });
    tabs.getState().open({ id: "t1", kind: "table", title: "orders" });
    executions.getState().start("c1", START);
    executions.getState().start("t1", START);

    tabs.getState().close("c1");
    unwire();

    expect(Object.keys(executions.getState().byTab)).toEqual(["t1"]);
  });
});
