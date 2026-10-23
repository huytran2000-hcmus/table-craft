/** Why the engine gave a session up while a statement ran (decision 054). */
export type LostReason = "cancelUnanswered" | "serverUnreachable";

export class StatementTimedOut extends Error {
  constructor(readonly seconds: number) {
    super(`The statement ran past ${String(seconds)} s.`);
    this.name = "StatementTimedOut";
  }
}

export class SessionLost extends Error {
  constructor(readonly reason: LostReason) {
    super(`The session was lost: ${reason}.`);
    this.name = "SessionLost";
  }
}

export interface WatchTimers {
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(timer: unknown): void;
}

const SYSTEM_TIMERS: WatchTimers = {
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (timer) => {
    clearTimeout(timer as ReturnType<typeof setTimeout>);
  },
};

export interface WatchOptions {
  /** 0 sets no limit; so does an absent `cancel`, since the engine cannot stop what it times out. */
  readonly timeoutSeconds: number;
  readonly cancel?: () => Promise<void>;
  /** How long a cancelled statement may take to end before its session counts as lost. */
  readonly graceMs: number;
  /** 0 never probes. */
  readonly probeEveryMs: number;
  /**
   * Opens and drops a connection of its own; settles when the server answered either way. Only
   * silence says the route is gone: a refusal arrives fast and proves the path still carries packets.
   */
  readonly probe?: () => Promise<void>;
  readonly probeWindowMs: number;
  readonly timers?: WatchTimers;
}

const MS_PER_SECOND = 1_000;

/**
 * `work`'s outcome, unless it overruns the timeout (cancelled, then {@link StatementTimedOut}) or the
 * server stops answering a probe while it runs ({@link SessionLost}). A timer is armed only for
 * what is asked, so a statement with neither costs nothing.
 */
export function watchStatement<T>(work: Promise<T>, options: WatchOptions): Promise<T> {
  const timers = options.timers ?? SYSTEM_TIMERS;
  const { cancel, probe } = options;
  const timeoutMs = cancel === undefined ? 0 : options.timeoutSeconds * MS_PER_SECOND;
  const probing = probe !== undefined && options.probeEveryMs > 0;
  if (timeoutMs <= 0 && !probing) return work;

  return new Promise<T>((resolve, reject) => {
    const armed = new Set<unknown>();
    let settled = false;
    let timedOut = false;

    function arm(run: () => void, ms: number): unknown {
      const timer = timers.setTimeout(() => {
        armed.delete(timer);
        run();
      }, ms);
      armed.add(timer);
      return timer;
    }

    function disarm(timer: unknown): void {
      if (armed.delete(timer)) timers.clearTimeout(timer);
    }

    function finish(settle: () => void): void {
      if (settled) return;
      settled = true;
      for (const timer of armed) timers.clearTimeout(timer);
      armed.clear();
      settle();
    }

    work.then(
      (value) => {
        finish(() => {
          resolve(value);
        });
      },
      (cause: unknown) => {
        finish(() => {
          // The work's own rejection passes through as it came, Error or not.
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
          reject(timedOut ? new StatementTimedOut(options.timeoutSeconds) : cause);
        });
      },
    );

    if (timeoutMs > 0 && cancel !== undefined) {
      arm(() => {
        timedOut = true;
        void cancel().catch(() => undefined);
        arm(() => {
          finish(() => {
            reject(new SessionLost("cancelUnanswered"));
          });
        }, options.graceMs);
      }, timeoutMs);
    }

    if (probing) {
      const nextProbe = (): void => {
        arm(() => {
          if (settled || timedOut) return;
          const deadline = arm(() => {
            if (timedOut) return;
            finish(() => {
              reject(new SessionLost("serverUnreachable"));
            });
          }, options.probeWindowMs);
          void probe()
            .catch(() => undefined)
            .then(() => {
              disarm(deadline);
              if (!settled) nextProbe();
            });
        }, options.probeEveryMs);
      };
      nextProbe();
    }
  });
}
