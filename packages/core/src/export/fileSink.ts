import { open, rename, rm } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { ExportError } from "@table-craft/core/export/errors.js";

/** Bytes gathered before one write: few enough syscalls, and the most an export holds unwritten. */
export const SINK_BATCH_BYTES = 1 << 20;
export const PART_SUFFIX = ".part";

const DISK_FULL_CODES: ReadonlySet<string> = new Set(["ENOSPC", "EDQUOT"]);
const DISK_FULL_HINT = "Free some space or choose another folder, then export again.";
const FILE_HINT = "Check that the folder exists and is writable, then export again.";
const BYTE_UNITS = ["bytes", "KB", "MB", "GB", "TB"] as const;
const BYTE_UNIT_STEP = 1000;

export interface SinkFile {
  write(data: Uint8Array): Promise<{ bytesWritten: number }>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

/** The filesystem calls a sink makes; tests inject failures through it. */
export interface SinkFiles {
  /** Creates `path` exclusively: it must not exist. */
  create(path: string): Promise<SinkFile>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Makes a rename in `directory` durable; a platform that cannot is not an error. */
  syncDirectory(directory: string): Promise<void>;
}

export const nodeSinkFiles: SinkFiles = {
  create: (path) => open(path, "wx"),
  rename,
  remove: (path) => rm(path, { force: true }),
  async syncDirectory(directory) {
    // Windows cannot open a directory for fsync; the rename is still atomic there.
    const handle = await open(directory, "r").catch(() => null);
    if (handle === null) return;
    try {
      await handle.sync().catch(() => undefined);
    } finally {
      await handle.close();
    }
  },
};

/** A file written beside its target and moved into place only when complete (decision 040). */
export interface FileSink {
  readonly path: string;
  readonly partPath: string;
  /** Bytes accepted so far, written or waiting in the batch. */
  readonly bytes: number;
  /** Resolves once the data is in the batch, or written when the batch filled. */
  write(chunk: string | Uint8Array): Promise<void>;
  /** Flush, fsync, close, rename over the target, fsync the folder. */
  commit(): Promise<void>;
  /** Close and remove the temporary file; the target is untouched. Never rejects. */
  abort(): Promise<void>;
}

/** `bytes` as people read it: `1.2 GB`. */
export function byteSize(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= BYTE_UNIT_STEP && unit < BYTE_UNITS.length - 1) {
    value /= BYTE_UNIT_STEP;
    unit += 1;
  }
  return unit === 0 ? `${String(bytes)} bytes` : `${value.toFixed(1)} ${BYTE_UNITS[unit] ?? ""}`;
}

function codeOf(cause: unknown): string | undefined {
  const code = (cause as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

function fileFailure(cause: unknown, written: number, path: string): ExportError {
  if (DISK_FULL_CODES.has(codeOf(cause) ?? "")) {
    return new ExportError(
      "diskFull",
      `The disk is full: ${byteSize(written)} written to ${dirname(path)}.`,
      DISK_FULL_HINT,
      0,
      cause,
    );
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  return new ExportError("file", `Could not write ${basename(path)}: ${message}`, FILE_HINT, 0, cause);
}

/** `<path>.<taskId>.part`: two exports to one target never share a temporary file. */
export function partPathOf(path: string, taskId: string): string {
  return `${path}.${taskId}${PART_SUFFIX}`;
}

export async function openFileSink(path: string, taskId: string, files: SinkFiles = nodeSinkFiles): Promise<FileSink> {
  const partPath = partPathOf(path, taskId);
  const file = await files.create(partPath).catch((cause: unknown) => {
    throw fileFailure(cause, 0, path);
  });
  const encoder = new TextEncoder();
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let written = 0;
  let closed = false;

  async function writeAll(data: Uint8Array): Promise<void> {
    let offset = 0;
    while (offset < data.byteLength) {
      const { bytesWritten } = await file.write(data.subarray(offset));
      offset += bytesWritten;
      written += bytesWritten;
    }
  }

  async function flush(): Promise<void> {
    if (pendingBytes === 0) return;
    const batch = new Uint8Array(pendingBytes);
    let offset = 0;
    for (const part of pending) {
      batch.set(part, offset);
      offset += part.byteLength;
    }
    pending = [];
    pendingBytes = 0;
    try {
      await writeAll(batch);
    } catch (cause) {
      throw fileFailure(cause, written, path);
    }
  }

  async function closeOnce(): Promise<void> {
    if (closed) return;
    closed = true;
    await file.close();
  }

  return {
    path,
    partPath,
    get bytes() {
      return written + pendingBytes;
    },
    async write(chunk) {
      const data = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
      if (data.byteLength === 0) return;
      pending.push(data);
      pendingBytes += data.byteLength;
      if (pendingBytes >= SINK_BATCH_BYTES) await flush();
    },
    async commit() {
      await flush();
      try {
        await file.sync();
        await closeOnce();
        await files.rename(partPath, path);
      } catch (cause) {
        throw fileFailure(cause, written, path);
      }
      await files.syncDirectory(dirname(path));
    },
    async abort() {
      pending = [];
      pendingBytes = 0;
      await closeOnce().catch(() => undefined);
      await files.remove(partPath).catch(() => undefined);
    },
  };
}
