import { createLogger, type Logger, type LogRecord } from "@table-craft/desktop/log/record.js";
import { BRIDGE_KEY, type TableCraftBridge } from "@table-craft/desktop/preload/bridge.js";

/** Plan 017 decision 8: a batch leaves after this long, or sooner when it is full. */
export const LOG_FLUSH_MS = 500;
export const LOG_BATCH_RECORDS = 100;

/** Main replaces it with `renderer`; the renderer never chooses its own process name. */
const PROCESS_PLACEHOLDER = "renderer";

export interface RendererLogOptions {
  readonly send: (records: readonly LogRecord[]) => void;
  readonly setTimeout: (run: () => void, ms: number) => unknown;
  readonly clearTimeout: (timer: unknown) => void;
  readonly now?: () => Date;
}

export interface RendererLog {
  logger(scope: string): Logger;
  /** Sends what is queued now; on `pagehide` so a closing window keeps its last records. */
  flush(): void;
}

export function createRendererLog(options: RendererLogOptions): RendererLog {
  let queued: LogRecord[] = [];
  let timer: unknown = null;

  const flush = () => {
    if (timer !== null) options.clearTimeout(timer);
    timer = null;
    if (queued.length === 0) return;
    const batch = queued;
    queued = [];
    options.send(batch);
  };

  const sink = (record: LogRecord) => {
    queued.push(record);
    if (queued.length >= LOG_BATCH_RECORDS) flush();
    else timer ??= options.setTimeout(flush, LOG_FLUSH_MS);
  };

  return {
    logger: (scope) =>
      createLogger({
        process: PROCESS_PLACEHOLDER,
        scope,
        sink,
        ...(options.now === undefined ? {} : { now: options.now }),
      }),
    flush,
  };
}

function windowBridge(): TableCraftBridge | undefined {
  return typeof window === "undefined"
    ? undefined
    : (window as unknown as Partial<Record<typeof BRIDGE_KEY, TableCraftBridge>>)[BRIDGE_KEY];
}

/** The window's log: silent where there is no bridge, as under Vitest. */
const shared = createRendererLog({
  send: (records) => void windowBridge()?.logWrite(records),
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (timer) => globalThis.clearTimeout(timer as ReturnType<typeof globalThis.setTimeout>),
});

export function rendererLog(scope: string): Logger {
  return shared.logger(scope);
}

/** Uncaught errors and rejections in the window go to the log (plan 017 decision 7). */
export function installRendererErrorLog(target: Window): void {
  const log = rendererLog("window");
  target.addEventListener("error", (event) => {
    log.error("uncaught error", { err: event.error ?? event.message, source: event.filename, line: event.lineno });
  });
  target.addEventListener("unhandledrejection", (event) => {
    log.error("unhandled rejection", { err: event.reason });
  });
  target.addEventListener("pagehide", () => shared.flush());
}
