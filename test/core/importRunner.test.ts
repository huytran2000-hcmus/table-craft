import {
  CSV_FORMAT,
  ImportError,
  RowsRefused,
  runImport,
  type ExportClock,
  type ImportWriter,
  type RejectedSink,
  type RunImportOptions,
} from "@table-craft/core";
import type { InsertRow } from "@table-craft/plugin-api";
import { describe, expect, it } from "vitest";

const STALL_MS = 1_000;
const ENCODE = new TextEncoder();

async function* fileOf(text: string, size = 7): AsyncGenerator<Uint8Array> {
  const bytes = ENCODE.encode(text);
  await Promise.resolve();
  for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size);
}

function csvOf(count: number, bad: readonly number[] = []): string {
  let text = "id,name\n";
  for (let n = 1; n <= count; n += 1) text += `${bad.includes(n) ? "bad" : String(n)},name ${String(n)}\n`;
  return text;
}

/** A table in memory: refuses a row whose id is not a number; commits and rolls back like a database. */
function fakeTable(options: { failInsertAfter?: number; failCommit?: number; hang?: boolean } = {}) {
  const committed: InsertRow[] = [];
  let pending: InsertRow[] = [];
  const calls = { insert: 0, commit: 0, rollback: 0 };
  const writer: ImportWriter = {
    async insert(rows) {
      calls.insert += 1;
      if (options.hang === true) return new Promise<void>(() => undefined);
      await Promise.resolve();
      if (options.failInsertAfter !== undefined && committed.length + pending.length >= options.failInsertAfter) {
        throw new Error("Connection terminated unexpectedly");
      }
      const refused = rows.find((row) => !/^\d+$/u.test(row[0] ?? ""));
      if (refused !== undefined)
        throw new RowsRefused(`invalid input syntax for type integer: "${String(refused[0])}"`);
      pending.push(...rows);
    },
    async commit() {
      calls.commit += 1;
      await Promise.resolve();
      if (options.failCommit === calls.commit) throw new Error("Connection lost during commit");
      committed.push(...pending);
      pending = [];
    },
    async rollback() {
      calls.rollback += 1;
      await Promise.resolve();
      pending = [];
    },
  };
  return { writer, committed, calls };
}

function memorySink(): RejectedSink & { text: string } {
  const sink = {
    text: "",
    get bytes() {
      return sink.text.length;
    },
    write(text: string) {
      sink.text += text;
      return Promise.resolve();
    },
    truncate(bytes: number) {
      sink.text = sink.text.slice(0, bytes);
      return Promise.resolve();
    },
  };
  return sink;
}

function options(writer: ImportWriter, text: string, overrides: Partial<RunImportOptions> = {}): RunImportOptions {
  return {
    source: fileOf(text),
    format: CSV_FORMAT,
    fields: [0, 1],
    skipRows: 0,
    transaction: { mode: "all" },
    errors: { mode: "stop" },
    writer,
    rejected: null,
    signal: new AbortController().signal,
    stallMs: STALL_MS,
    batchRows: 4,
    ...overrides,
  };
}

async function failureOf(pending: Promise<unknown>): Promise<ImportError> {
  try {
    await pending;
  } catch (cause) {
    if (cause instanceof ImportError) return cause;
    throw cause;
  }
  throw new Error("expected the import to fail");
}

function manualClock(): ExportClock & { fire(): void } {
  const timers = new Map<number, () => void>();
  let next = 1;
  return {
    now: () => 0,
    setTimeout(run) {
      timers.set(next, run);
      return next++;
    },
    clearTimeout(timer) {
      timers.delete(timer as number);
    },
    fire() {
      for (const run of [...timers.values()]) run();
      timers.clear();
    },
  };
}

describe("import runner", () => {
  it("givenRows_whenImported_thenAllCommittedOnce", async () => {
    const table = fakeTable();

    const outcome = await runImport(options(table.writer, csvOf(10)));

    expect(table.committed).toHaveLength(10);
    expect(table.committed[0]).toEqual(["1", "name 1"]);
    expect(table.calls.commit).toBe(1);
    expect(outcome).toMatchObject({ read: 10, written: 10, committed: 10, rejected: 0, resumeFrom: 11 });
    expect(outcome.bytes).toBe(ENCODE.encode(csvOf(10)).length);
  });

  it("givenStopPolicy_whenBatchRefused_thenFailsWithRowLineAndRollsBack", async () => {
    const table = fakeTable();

    const error = await failureOf(runImport(options(table.writer, csvOf(10, [6]))));

    expect(error.reason).toBe("badRow");
    expect(error.message).toMatch(/^Row 6 \(line 7\): invalid input syntax/u);
    expect(error.message).toMatch(/Nothing was imported/u);
    expect(table.committed).toHaveLength(0);
    expect(table.calls.rollback).toBe(1);
  });

  it("givenSkipPolicy_whenBatchRefused_thenOnlyBadRowsRejected", async () => {
    const table = fakeTable();
    const sink = memorySink();

    const outcome = await runImport(
      options(table.writer, csvOf(10, [2, 7]), { errors: { mode: "skip", limit: 5 }, rejected: sink }),
    );

    expect(table.committed.map((row) => row[0])).toEqual(["1", "3", "4", "5", "6", "8", "9", "10"]);
    expect(outcome).toMatchObject({ written: 8, committed: 8, rejected: 2 });
    expect(sink.text.split("\n")).toEqual([
      "id,name,rejected_line,rejected_reason",
      'bad,name 2,3,"invalid input syntax for type integer: ""bad"""',
      'bad,name 7,8,"invalid input syntax for type integer: ""bad"""',
      "",
    ]);
  });

  it("givenRaggedRow_whenSkip_thenRejectedWithFieldCount", async () => {
    const table = fakeTable();
    const sink = memorySink();

    await runImport(
      options(table.writer, "id,name\n1,a\n2\n3,c\n", { errors: { mode: "skip", limit: 5 }, rejected: sink }),
    );

    expect(table.committed).toHaveLength(2);
    expect(sink.text).toMatch(/2,3,it has 1 field; the header has 2/u);
  });

  it("givenSkipLimit_whenExceeded_thenFailsAndRejectedFileCutBack", async () => {
    const table = fakeTable();
    const sink = memorySink();

    const error = await failureOf(
      runImport(options(table.writer, csvOf(10, [1, 2, 3]), { errors: { mode: "skip", limit: 2 }, rejected: sink })),
    );

    expect(error.reason).toBe("tooManyRejected");
    expect(error.message).toMatch(/^More than 2 rows were rejected; the last, row 3 \(line 4\)/u);
    expect(sink.text).toBe("");
    expect(error.counts.rejected).toBe(0);
  });

  it("givenCommitEvery_whenWriteFails_thenCommittedAndResumeFrom", async () => {
    const table = fakeTable({ failInsertAfter: 6 });

    const error = await failureOf(
      runImport(options(table.writer, csvOf(10), { transaction: { mode: "every", rows: 3 } })),
    );

    expect(error.reason).toBe("target");
    expect(table.committed).toHaveLength(6);
    expect(error.counts).toMatchObject({ committed: 6, resumeFrom: 7, ambiguous: false });
    expect(error.message).toMatch(/6 rows are committed; resume from row 7\./u);
    expect(error.hint).toMatch(/Resume/u);
  });

  it("givenResume_whenStarted_thenSkipsCommittedRows", async () => {
    const table = fakeTable();

    const outcome = await runImport(
      options(table.writer, csvOf(10), { skipRows: 6, transaction: { mode: "every", rows: 3 } }),
    );

    expect(table.committed.map((row) => row[0])).toEqual(["7", "8", "9", "10"]);
    expect(outcome).toMatchObject({ read: 4, committed: 4, resumeFrom: 11 });
  });

  it("givenCommitFails_whenEvery_thenAmbiguous", async () => {
    const table = fakeTable({ failCommit: 2 });

    const error = await failureOf(
      runImport(options(table.writer, csvOf(10), { transaction: { mode: "every", rows: 3 } })),
    );

    expect(error.counts).toMatchObject({ committed: 3, written: 6, resumeFrom: 4, ambiguous: true });
    expect(error.message).toMatch(/3 rows are committed; the last commit's 3 rows may or may not be/u);
  });

  it("givenAllOrNothing_whenCancelled_thenRolledBack", async () => {
    const table = fakeTable();
    const controller = new AbortController();
    const writer: ImportWriter = {
      ...table.writer,
      async insert(rows) {
        await table.writer.insert(rows);
        controller.abort();
      },
    };

    const error = await failureOf(runImport(options(writer, csvOf(10), { signal: controller.signal })));

    expect(error.reason).toBe("cancelled");
    expect(error.message).toBe("Import cancelled. Nothing was imported: the transaction was rolled back.");
    expect(table.committed).toHaveLength(0);
    expect(table.calls.rollback).toBe(1);
  });

  it("givenStall_whenWriting_thenStalledAndSessionClosed", async () => {
    const table = fakeTable({ hang: true });
    const clock = manualClock();
    let closed = false;

    const pending = failureOf(
      runImport(
        options(table.writer, csvOf(10), {
          clock,
          onStall: () => {
            closed = true;
          },
        }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    clock.fire();
    const error = await pending;

    expect(error.reason).toBe("stalled");
    expect(error.message).toMatch(/answered nothing for 1 second/u);
    expect(closed).toBe(true);
    expect(table.calls.rollback).toBe(0);
  });

  it("givenUnterminatedQuote_whenImported_thenFileFailure", async () => {
    const table = fakeTable();

    const error = await failureOf(runImport(options(table.writer, 'id,name\n1,"open\n')));

    expect(error.reason).toBe("file");
    expect(error.hint).toMatch(/format options/u);
  });

  it("givenMappedSubset_whenImported_thenOnlyMappedFields", async () => {
    const table = fakeTable();

    await runImport(options(table.writer, "name,id\nann,1\n", { fields: [1, 0] }));

    expect(table.committed).toEqual([["1", "ann"]]);
  });
});
