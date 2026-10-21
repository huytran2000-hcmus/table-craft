import type { EngineProcess, HostDependencies } from "@table-craft/desktop/main/hosts.js";

/** A pretend `utilityProcess`: records what main posts and lets the test answer or exit. */
export class FakeEngineProcess implements EngineProcess {
  readonly posted: unknown[] = [];
  killed = false;
  readonly #messageListeners: ((message: unknown) => void)[] = [];
  readonly #exitListeners: ((code: number) => void)[] = [];

  constructor(readonly serviceName: string) {}

  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  on(_event: "message", listener: (message: unknown) => void): this {
    this.#messageListeners.push(listener);
    return this;
  }
  once(_event: "exit", listener: (code: number) => void): this {
    this.#exitListeners.push(listener);
    return this;
  }
  kill(): boolean {
    this.killed = true;
    this.exit(1);
    return true;
  }
  /** What the engine would post on its parent port. */
  answer(message: unknown): void {
    for (const listener of this.#messageListeners) listener(message);
  }
  exit(code: number): void {
    const listeners = this.#exitListeners.splice(0);
    for (const listener of listeners) listener(code);
  }
}

export interface FakeHostDependencies extends HostDependencies<string> {
  readonly forked: FakeEngineProcess[];
  /** `[datasourceId, target]` per port handed out. */
  readonly ports: [string, string][];
  /** Runs every pending timer, as if its delay had elapsed. */
  elapse(): void;
}

export function fakeHostDependencies(): FakeHostDependencies {
  const forked: FakeEngineProcess[] = [];
  const ports: [string, string][] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  return {
    forked,
    ports,
    fork(serviceName) {
      const process = new FakeEngineProcess(serviceName);
      forked.push(process);
      return process;
    },
    connectPort(_host, datasourceId, target) {
      ports.push([datasourceId, target]);
    },
    setTimeout(run) {
      const id = nextTimer++;
      timers.set(id, run);
      return id;
    },
    clearTimeout(timer) {
      timers.delete(timer as number);
    },
    elapse() {
      const pending = [...timers.values()];
      timers.clear();
      for (const run of pending) run();
    },
  };
}
