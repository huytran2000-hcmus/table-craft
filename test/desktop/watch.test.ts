import { describe, expect, it } from "vitest";
import {
  SessionLost,
  StatementTimedOut,
  watchStatement,
  type WatchOptions,
  type WatchTimers,
} from "@table-craft/desktop/engine/watch.js";

interface Timer {
  readonly due: number;
  readonly run: () => void;
}

/** Timers that move only when told, so a test reads as a timeline. */
function fakeTimers(): WatchTimers & { advance(ms: number): Promise<void>; pending(): number } {
  let clock = 0;
  const timers = new Set<Timer>();
  const flush = async (): Promise<void> => {
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
  };
  return {
    setTimeout(run, ms) {
      const timer = { due: clock + ms, run };
      timers.add(timer);
      return timer;
    },
    clearTimeout(timer) {
      timers.delete(timer as Timer);
    },
    async advance(ms) {
      const until = clock + ms;
      for (;;) {
        await flush();
        const next = [...timers].sort((a, b) => a.due - b.due)[0];
        if (next === undefined || next.due > until) break;
        timers.delete(next);
        clock = next.due;
        next.run();
      }
      clock = until;
      await flush();
    },
    pending: () => timers.size,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(cause: unknown): void } {
  let resolve: (value: T) => void = () => undefined;
  let reject: (cause: unknown) => void = () => undefined;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const GRACE_MS = 5_000;
const PROBE_EVERY_MS = 30_000;
const PROBE_WINDOW_MS = 5_000;

function options(timers: WatchTimers, overrides: Partial<WatchOptions>): WatchOptions {
  return {
    timeoutSeconds: 0,
    graceMs: GRACE_MS,
    probeEveryMs: 0,
    probeWindowMs: PROBE_WINDOW_MS,
    timers,
    ...overrides,
  };
}

type Outcome = { value: unknown } | { error: unknown } | "pending";

function track(promise: Promise<unknown>): () => Outcome {
  let outcome: Outcome = "pending";
  promise.then(
    (value: unknown) => {
      outcome = { value };
    },
    (error: unknown) => {
      outcome = { error };
    },
  );
  return () => outcome;
}

describe("watchStatement", () => {
  it("givenWorkSettlesFirst_whenWatched_thenItsOutcome", async () => {
    const timers = fakeTimers();
    const work = deferred<string>();
    const outcome = track(
      watchStatement(work.promise, options(timers, { timeoutSeconds: 10, cancel: () => Promise.resolve() })),
    );
    await timers.advance(1_000);
    work.resolve("rows");
    await timers.advance(0);
    expect(outcome()).toEqual({ value: "rows" });
    expect(timers.pending()).toBe(0);
  });

  it("givenTimeout_whenCancelEndsWork_thenTimedOut", async () => {
    const timers = fakeTimers();
    const work = deferred<string>();
    let cancelled = 0;
    const cancel = (): Promise<void> => {
      cancelled += 1;
      work.reject(new Error("canceling statement due to user request"));
      return Promise.resolve();
    };
    const outcome = track(watchStatement(work.promise, options(timers, { timeoutSeconds: 5, cancel })));
    await timers.advance(4_999);
    expect(cancelled).toBe(0);
    await timers.advance(1);
    expect(cancelled).toBe(1);
    const result = outcome();
    expect(result !== "pending" && "error" in result && result.error).toBeInstanceOf(StatementTimedOut);
  });

  it("givenTimeout_whenCancelUnanswered_thenLost", async () => {
    const timers = fakeTimers();
    const work = deferred<string>();
    const outcome = track(
      watchStatement(work.promise, options(timers, { timeoutSeconds: 5, cancel: () => Promise.resolve() })),
    );
    await timers.advance(5_000 + GRACE_MS - 1);
    expect(outcome()).toBe("pending");
    await timers.advance(1);
    const result = outcome();
    const error = result !== "pending" && "error" in result ? result.error : null;
    expect(error).toBeInstanceOf(SessionLost);
    expect((error as SessionLost).reason).toBe("cancelUnanswered");
  });

  it("givenTimeout_whenWorkFinishesDuringGrace_thenValue", async () => {
    const timers = fakeTimers();
    const work = deferred<string>();
    const outcome = track(
      watchStatement(work.promise, options(timers, { timeoutSeconds: 5, cancel: () => Promise.resolve() })),
    );
    await timers.advance(6_000);
    work.resolve("rows");
    await timers.advance(0);
    expect(outcome()).toEqual({ value: "rows" });
  });

  it("givenProbeUnanswered_whenInFlight_thenLost", async () => {
    const timers = fakeTimers();
    const work = deferred<string>();
    let probes = 0;
    const probe = (): Promise<void> => {
      probes += 1;
      return new Promise<void>(() => undefined);
    };
    const outcome = track(watchStatement(work.promise, options(timers, { probeEveryMs: PROBE_EVERY_MS, probe })));
    await timers.advance(PROBE_EVERY_MS);
    expect(probes).toBe(1);
    await timers.advance(PROBE_WINDOW_MS - 1);
    expect(outcome()).toBe("pending");
    await timers.advance(1);
    const result = outcome();
    const error = result !== "pending" && "error" in result ? result.error : null;
    expect(error).toBeInstanceOf(SessionLost);
    expect((error as SessionLost).reason).toBe("serverUnreachable");
    expect(timers.pending()).toBe(0);
  });

  it("givenProbeFailsFast_whenInFlight_thenKeepsWaiting", async () => {
    const timers = fakeTimers();
    const work = deferred<string>();
    let probes = 0;
    const probe = (): Promise<void> => {
      probes += 1;
      return Promise.reject(new Error("connect ECONNREFUSED"));
    };
    const outcome = track(watchStatement(work.promise, options(timers, { probeEveryMs: PROBE_EVERY_MS, probe })));
    await timers.advance(PROBE_EVERY_MS * 3);
    expect(probes).toBe(3);
    expect(outcome()).toBe("pending");
    work.resolve("rows");
    await timers.advance(0);
    expect(outcome()).toEqual({ value: "rows" });
    expect(timers.pending()).toBe(0);
  });

  it("givenNoTimeoutNoKeepAlive_whenWatched_thenNoTimers", async () => {
    const timers = fakeTimers();
    const work = Promise.resolve("rows");
    const watched = watchStatement(work, options(timers, { timeoutSeconds: 30 }));
    expect(watched).toBe(work);
    expect(timers.pending()).toBe(0);
    await expect(watched).resolves.toBe("rows");
  });
});
