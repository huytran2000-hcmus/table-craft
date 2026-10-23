/**
 * The log record every process produces and main alone writes (plan 017, decision 038). Pure, so
 * main, the engine and the renderer share one shape and one level order.
 */

export const LOG_LEVELS = ["error", "warn", "info", "debug"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const DEFAULT_LOG_LEVEL: LogLevel = "info";

/** How many records the Log tool window holds at most (plan 017 decision 11). */
export const LOG_READ_LIMIT = 2000;

/** How deep a `cause` chain is followed; a cycle or a pathological chain stops here. */
export const ERROR_CAUSE_DEPTH = 5;

export interface LoggedError {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
  readonly stack?: string;
  readonly cause?: LoggedError;
}

export interface LogRecord {
  readonly ts: string;
  readonly level: LogLevel;
  readonly process: string;
  readonly scope: string;
  readonly msg: string;
  readonly err?: LoggedError;
  readonly [field: string]: unknown;
}

/** Extra structured fields; `err` takes any thrown value and is serialised with its cause chain. */
export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  error(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  debug(msg: string, fields?: LogFields): void;
  /** A logger for a subsystem; `fields` are added to every record it writes. */
  child(scope: string, fields?: LogFields): Logger;
}

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && (LOG_LEVELS as readonly string[]).includes(value);
}

/** Whether a record at `level` is written when the log is set to `threshold`. */
export function enabled(level: LogLevel, threshold: LogLevel): boolean {
  return LOG_LEVELS.indexOf(level) <= LOG_LEVELS.indexOf(threshold);
}

function stringCode(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

export function serializeError(cause: unknown, depth = ERROR_CAUSE_DEPTH): LoggedError {
  if (cause instanceof Error) {
    const code = stringCode((cause as { code?: unknown }).code);
    const inner = depth > 1 && cause.cause !== undefined ? serializeError(cause.cause, depth - 1) : undefined;
    return {
      name: cause.name,
      message: cause.message,
      ...(code === undefined ? {} : { code }),
      ...(cause.stack === undefined ? {} : { stack: cause.stack }),
      ...(inner === undefined ? {} : { cause: inner }),
    };
  }
  if (typeof cause === "object" && cause !== null) {
    const shape = cause as { name?: unknown; message?: unknown; code?: unknown };
    const code = stringCode(shape.code);
    return {
      name: typeof shape.name === "string" ? shape.name : "Object",
      message: typeof shape.message === "string" ? shape.message : safeJson(cause),
      ...(code === undefined ? {} : { code }),
    };
  }
  return { name: typeof cause, message: String(cause) };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export interface LoggerOptions {
  readonly process: string;
  readonly scope: string;
  readonly sink: (record: LogRecord) => void;
  readonly fields?: LogFields;
  readonly now?: () => Date;
}

/** A logger that builds records and hands them to `sink`; filtering and writing are the sink's job. */
export function createLogger(options: LoggerOptions): Logger {
  const now = options.now ?? (() => new Date());
  const base = options.fields ?? {};
  const write = (level: LogLevel) => (msg: string, fields?: LogFields) => {
    const {
      err,
      ts: _ts,
      level: _level,
      process: _process,
      scope: _scope,
      msg: _msg,
      ...rest
    } = { ...base, ...fields };
    options.sink({
      ts: now().toISOString(),
      level,
      process: options.process,
      scope: options.scope,
      msg,
      ...rest,
      ...(err === undefined ? {} : { err: serializeError(err) }),
    });
  };
  return {
    error: write("error"),
    warn: write("warn"),
    info: write("info"),
    debug: write("debug"),
    child: (scope, fields) => createLogger({ ...options, scope, fields: { ...base, ...fields } }),
  };
}
