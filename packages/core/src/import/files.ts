import { createReadStream } from "node:fs";
import { open, stat, unlink, type FileHandle } from "node:fs/promises";
import type { RejectedSink } from "@table-craft/core/import/runner.js";

/** Bytes read from the file at a time (plan 021, ruling 1). */
export const IMPORT_CHUNK_BYTES = 64 * 1024;

/** The file as a stream of chunks; only one chunk is in memory at a time. */
export function fileChunks(path: string): AsyncIterable<Uint8Array> {
  return createReadStream(path, { highWaterMark: IMPORT_CHUNK_BYTES });
}

export async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size;
}

export interface RejectedFile extends RejectedSink {
  readonly path: string;
  /** Closes the file; an empty one is removed, so a run that rejected nothing leaves nothing behind. */
  close(): Promise<void>;
}

function missing(cause: unknown): boolean {
  return (cause as { code?: unknown }).code === "ENOENT";
}

/**
 * The rejected-rows file beside the source, opened on the first write. A fresh import replaces
 * what an earlier run left there; a resumed one appends to it, so its header is written once.
 */
export async function openRejectedFile(path: string, resume: boolean): Promise<RejectedFile> {
  let bytes = 0;
  if (resume) {
    try {
      bytes = (await stat(path)).size;
    } catch (cause) {
      if (!missing(cause)) throw cause;
    }
  }
  let handle: FileHandle | null = null;
  const opened = async (): Promise<FileHandle> => {
    handle ??= await open(path, resume ? "a" : "w");
    return handle;
  };
  return {
    path,
    get bytes() {
      return bytes;
    },
    async write(text) {
      const file = await opened();
      const data = Buffer.from(text, "utf8");
      await file.appendFile(data);
      bytes += data.length;
    },
    async truncate(mark) {
      if (mark >= bytes) return;
      const file = await opened();
      await file.truncate(mark);
      bytes = mark;
    },
    async close() {
      if (handle === null) return;
      await handle.close();
      handle = null;
      if (bytes === 0) await unlink(path).catch(() => undefined);
    },
  };
}
