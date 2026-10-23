import { describe, expect, it } from "vitest";
import { CSV_FORMAT, type ImportWriter } from "@table-craft/core";
import { importTasks, type ImportJob } from "@table-craft/desktop/engine/imports.js";
import type { ImportEvent, ImportTask } from "@table-craft/desktop/engine/protocol.js";

const FILE = "/data/secret-customers.csv";
const TABLE = '"main"."customers"';
const STALL_MS = 60_000;
const SHORT_STALL_MS = 50;

function chunksOf(text: string): (file: string) => AsyncIterable<Uint8Array> {
  return async function* () {
    yield await Promise.resolve(new TextEncoder().encode(text));
  };
}

interface Recorded {
  readonly calls: string[];
  closed: number;
}

function job(writer: ImportWriter, recorded: Recorded, overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    file: FILE,
    size: 0,
    format: CSV_FORMAT,
    table: TABLE,
    created: false,
    fields: [0, 1],
    transaction: { mode: "all" },
    errors: { mode: "stop" },
    open: () =>
      Promise.resolve({
        writer,
        close: () => {
          recorded.closed += 1;
          return Promise.resolve();
        },
      }),
    ...overrides,
  };
}

function writerOf(recorded: Recorded, insert: () => Promise<void> = () => Promise.resolve()): ImportWriter {
  return {
    insert: () => {
      recorded.calls.push("insert");
      return insert();
    },
    commit: () => {
      recorded.calls.push("commit");
      return Promise.resolve();
    },
    rollback: () => {
      recorded.calls.push("rollback");
      return Promise.resolve();
    },
  };
}

function finalOf(events: ImportEvent[], taskId: string): Promise<ImportTask> {
  return new Promise((resolve) => {
    const check = (): void => {
      const final = events.find((event) => event.task.taskId === taskId && event.type !== "import.progress");
      if (final === undefined) setTimeout(check, 5);
      else resolve(final.task);
    };
    check();
  });
}

describe("import tasks", () => {
  it("givenRunningImport_whenCancelled_thenRolledBackAndCancelled", async () => {
    const recorded: Recorded = { calls: [], closed: 0 };
    const events: ImportEvent[] = [];
    const tasks = importTasks({ chunks: chunksOf("a,b\n1,2\n") });
    tasks.subscribe((event) => events.push(event));
    let entered = (): void => undefined;
    const inserting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const writer = writerOf(recorded, () => {
      entered();
      return new Promise<void>(() => undefined);
    });

    const task = tasks.start(job(writer, recorded), STALL_MS);
    await inserting;
    tasks.cancel(task.taskId);
    const done = await finalOf(events, task.taskId);

    expect(done.state).toBe("cancelled");
    expect(done.error?.code).toBe("cancelled");
    expect(recorded.calls).toEqual(["insert", "rollback"]);
    expect(recorded.closed).toBe(1);
  });

  it("givenSilentServer_whenStallPasses_thenStalledAndSessionClosed", async () => {
    const recorded: Recorded = { calls: [], closed: 0 };
    const events: ImportEvent[] = [];
    const tasks = importTasks({ chunks: chunksOf("a,b\n1,2\n") });
    tasks.subscribe((event) => events.push(event));
    const writer = writerOf(recorded, () => new Promise<void>(() => undefined));

    const task = tasks.start(job(writer, recorded), SHORT_STALL_MS);
    const done = await finalOf(events, task.taskId);

    expect(done.state).toBe("failed");
    expect(done.error).toMatchObject({ code: "timedOut", reason: "stalled" });
    expect(recorded.calls).toEqual(["insert"]);
    expect(recorded.closed).toBe(1);
  });

  it("givenConnectFails_whenStarted_thenFailedSayingSo", async () => {
    const recorded: Recorded = { calls: [], closed: 0 };
    const events: ImportEvent[] = [];
    const tasks = importTasks({ chunks: chunksOf("a,b\n1,2\n") });
    tasks.subscribe((event) => events.push(event));

    const task = tasks.start(
      job(writerOf(recorded), recorded, { open: () => Promise.reject(new Error("ECONNREFUSED")) }),
      STALL_MS,
    );
    const done = await finalOf(events, task.taskId);

    expect(done.state).toBe("failed");
    expect(done.error?.message).toBe("The import could not connect: ECONNREFUSED");
  });

  it("givenFinishedImport_whenLogged_thenCountsButNeverPathOrTable", async () => {
    const recorded: Recorded = { calls: [], closed: 0 };
    const lines: [string, unknown][] = [];
    const log = {
      info: (message: string, fields?: unknown) => void lines.push([message, fields]),
      warn: (message: string, fields?: unknown) => void lines.push([message, fields]),
    };
    const events: ImportEvent[] = [];
    const tasks = importTasks({ chunks: chunksOf("a,b\n1,secret value\n"), log });
    tasks.subscribe((event) => events.push(event));

    const task = tasks.start(job(writerOf(recorded), recorded), STALL_MS);
    await finalOf(events, task.taskId);
    const text = JSON.stringify(lines);

    expect(lines[0]?.[0]).toBe("import finished");
    expect(lines[0]?.[1]).toMatchObject({ taskId: task.taskId, written: 1, committed: 1, transaction: "all" });
    expect(text).not.toContain("secret");
    expect(text).not.toContain("customers");
  });

  it("givenFailedImportWithCommits_whenResumed_thenNewTaskStartsAfterThem", async () => {
    const recorded: Recorded = { calls: [], closed: 0 };
    const events: ImportEvent[] = [];
    const tasks = importTasks({ chunks: chunksOf("a,b\n1,2\n3,4\n5\n") });
    tasks.subscribe((event) => events.push(event));

    const first = tasks.start(job(writerOf(recorded), recorded, { transaction: { mode: "every", rows: 1 } }), STALL_MS);
    const failed = await finalOf(events, first.taskId);
    const resumed = tasks.resume(first.taskId, STALL_MS);

    expect(failed).toMatchObject({ state: "failed", committed: 2, resumeFrom: 3 });
    expect(resumed).toMatchObject({ state: "running", resumeFrom: 3 });
    expect(resumed.taskId).not.toBe(first.taskId);
    await tasks.close();
  });
});
