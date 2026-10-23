/** When the automatic check runs: once after the first window shows, then every interval, while the setting allows. */

export interface ScheduleTimers {
  readonly setTimeout: (run: () => void, ms: number) => unknown;
  readonly clearTimeout: (timer: unknown) => void;
  readonly setInterval: (run: () => void, ms: number) => unknown;
  readonly clearInterval: (timer: unknown) => void;
}

export interface UpdateSchedule {
  /** The first window showed; the first check is due after the delay, if enabled. */
  readonly start: () => void;
  /** `updates.checkAutomatically` changed; turning it on after start schedules the first check again. */
  readonly setEnabled: (enabled: boolean) => void;
  readonly stop: () => void;
}

export function createUpdateSchedule(options: {
  readonly check: () => void;
  readonly enabled: boolean;
  readonly firstDelayMs: number;
  readonly intervalMs: number;
  readonly timers: ScheduleTimers;
}): UpdateSchedule {
  const { timers } = options;
  let enabled = options.enabled;
  let started = false;
  let first: unknown = null;
  let repeat: unknown = null;

  function clear(): void {
    if (first !== null) timers.clearTimeout(first);
    if (repeat !== null) timers.clearInterval(repeat);
    first = null;
    repeat = null;
  }

  function arm(): void {
    clear();
    if (!started || !enabled) return;
    first = timers.setTimeout(() => {
      first = null;
      options.check();
    }, options.firstDelayMs);
    repeat = timers.setInterval(options.check, options.intervalMs);
  }

  return {
    start() {
      if (started) return;
      started = true;
      arm();
    },
    setEnabled(next) {
      if (next === enabled) return;
      enabled = next;
      arm();
    },
    stop() {
      started = false;
      clear();
    },
  };
}
