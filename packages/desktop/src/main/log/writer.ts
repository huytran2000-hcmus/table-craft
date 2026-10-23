import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

export const LOG_DIRECTORY = "logs";
export const LOG_FILE = "table-craft.log";
/** Plan 017 decision 4: 5 MB a file, the current plus four rotated, so never more than 25 MB. */
export const LOG_FILE_BYTES = 5 * 1024 * 1024;
export const LOG_ROTATED_FILES = 4;

const LOG_STEM = "table-craft";
const LOG_EXTENSION = ".log";

/** The file names of the log, newest first: the current one, then `table-craft.1.log` … */
export function logFileNames(rotated = LOG_ROTATED_FILES): string[] {
  return [LOG_FILE, ...Array.from({ length: rotated }, (_, index) => `${LOG_STEM}.${index + 1}${LOG_EXTENSION}`)];
}

export interface LogFiles {
  append(path: string, text: string): Promise<void>;
  /** The file's size in bytes, or null when it does not exist. */
  size(path: string): Promise<number | null>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  makeDirectory(path: string): Promise<void>;
}

export const nodeLogFiles: LogFiles = {
  append: (path, text) => appendFile(path, text, "utf8"),
  async size(path) {
    try {
      return (await stat(path)).size;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw cause;
    }
  },
  rename: (from, to) => rename(from, to),
  remove: (path) => rm(path, { force: true }),
  makeDirectory: async (path) => {
    await mkdir(path, { recursive: true });
  },
};

export interface LogWriterOptions {
  readonly directory: string;
  readonly files: LogFiles;
  readonly maxBytes?: number;
  readonly rotated?: number;
  /** Called once when a write fails; the writer is disabled from then on rather than throwing. */
  readonly onFailure: (cause: unknown) => void;
}

export interface LogWriter {
  readonly directory: string;
  /** Absolute paths of every log file, newest first, whether or not each exists yet. */
  readonly paths: readonly string[];
  /** Queues complete lines (each ending in a newline); writes are serialised in call order. */
  append(lines: string): void;
  /** Resolves once every queued line is written. */
  drain(): Promise<void>;
}

/** The single writer of plan 017 decision 1: serialised appends, size-checked rotation before each. */
export function createLogWriter(options: LogWriterOptions): LogWriter {
  const maxBytes = options.maxBytes ?? LOG_FILE_BYTES;
  const paths = logFileNames(options.rotated ?? LOG_ROTATED_FILES).map((name) => join(options.directory, name));
  const current = paths[0] as string;
  let size: number | null = null;
  let failed = false;
  let queue: Promise<void> = Promise.resolve();

  const rotate = async () => {
    await options.files.remove(paths[paths.length - 1] as string);
    for (let index = paths.length - 2; index >= 0; index -= 1) {
      const from = paths[index] as string;
      if ((await options.files.size(from)) !== null) await options.files.rename(from, paths[index + 1] as string);
    }
    size = 0;
  };

  const writeLine = async (group: string[], groupBytes: number) => {
    if (group.length === 0) return;
    await options.files.append(current, group.join(""));
    size = (size ?? 0) + groupBytes;
  };

  /** Everything queued since the last write goes in one append, cut where a rotation falls. */
  const write = async (lines: readonly string[]) => {
    if (size === null) {
      await options.files.makeDirectory(options.directory);
      size = (await options.files.size(current)) ?? 0;
    }
    let group: string[] = [];
    let groupBytes = 0;
    for (const line of lines) {
      const bytes = Buffer.byteLength(line, "utf8");
      if (size + groupBytes > 0 && size + groupBytes + bytes > maxBytes) {
        await writeLine(group, groupBytes);
        group = [];
        groupBytes = 0;
        await rotate();
      }
      group.push(line);
      groupBytes += bytes;
    }
    await writeLine(group, groupBytes);
  };

  let pending: string[] = [];

  const flush = async () => {
    const lines = pending;
    pending = [];
    if (failed || lines.length === 0) return;
    try {
      await write(lines);
    } catch (cause: unknown) {
      if (failed) return;
      failed = true;
      options.onFailure(cause);
    }
  };

  return {
    directory: options.directory,
    paths,
    append(lines) {
      if (failed || lines === "") return;
      pending.push(lines);
      if (pending.length === 1) queue = queue.then(flush);
    },
    drain: () => queue,
  };
}
