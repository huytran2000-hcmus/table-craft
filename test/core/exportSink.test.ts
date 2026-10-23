import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExportError, nodeSinkFiles, openFileSink, SINK_BATCH_BYTES, type SinkFiles } from "@table-craft/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let folder = "";

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "tc-sink-"));
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

/** Real files, with every call recorded and `write` failing after `failAfter` bytes. */
function recordingFiles(calls: string[], failAfter = Number.POSITIVE_INFINITY, code = "ENOSPC"): SinkFiles {
  return {
    async create(path) {
      calls.push("create");
      const file = await nodeSinkFiles.create(path);
      let written = 0;
      return {
        async write(data) {
          if (written + data.byteLength > failAfter) {
            throw Object.assign(new Error(`${code}: no space left on device, write`), { code });
          }
          written += data.byteLength;
          calls.push("write");
          return file.write(data);
        },
        async sync() {
          calls.push("sync");
          await file.sync();
        },
        async close() {
          calls.push("close");
          await file.close();
        },
      };
    },
    async rename(from, to) {
      calls.push("rename");
      await nodeSinkFiles.rename(from, to);
    },
    async remove(path) {
      calls.push("remove");
      await nodeSinkFiles.remove(path);
    },
    async syncDirectory(directory) {
      calls.push("syncDirectory");
      await nodeSinkFiles.syncDirectory(directory);
    },
  };
}

describe("file sink", () => {
  it("givenRows_whenCommitted_thenFsyncBeforeRenameAndDirSynced", async () => {
    const calls: string[] = [];
    const target = join(folder, "out.csv");
    const sink = await openFileSink(target, "t1", recordingFiles(calls));

    await sink.write("a,b\n");
    await sink.write(new TextEncoder().encode("1,2\n"));
    await sink.commit();

    expect(calls).toEqual(["create", "write", "sync", "close", "rename", "syncDirectory"]);
    expect(await readFile(target, "utf8")).toBe("a,b\n1,2\n");
    expect(await readdir(folder)).toEqual(["out.csv"]);
    expect(sink.bytes).toBe(8);
  });

  it("givenMoreThanOneBatch_whenWriting_thenWritesBeforeCommit", async () => {
    const calls: string[] = [];
    const sink = await openFileSink(join(folder, "big.csv"), "t1", recordingFiles(calls));

    await sink.write("x".repeat(SINK_BATCH_BYTES));

    expect(calls).toContain("write");
    await sink.abort();
  });

  it("givenEnospc_whenWriting_thenDiskFullAndPartRemoved", async () => {
    const calls: string[] = [];
    const sink = await openFileSink(join(folder, "full.csv"), "t1", recordingFiles(calls, 10));

    const failed = await sink.write("y".repeat(SINK_BATCH_BYTES)).catch((cause: unknown) => cause);
    await sink.abort();

    expect(failed).toBeInstanceOf(ExportError);
    expect((failed as ExportError).reason).toBe("diskFull");
    expect((failed as ExportError).message).toBe(`The disk is full: 0 bytes written to ${folder}.`);
    expect(await readdir(folder)).toEqual([]);
  });

  it("givenEdquot_whenCommitting_thenDiskFull", async () => {
    const sink = await openFileSink(join(folder, "quota.csv"), "t1", recordingFiles([], 0, "EDQUOT"));
    await sink.write("z");

    const failed = await sink.commit().catch((cause: unknown) => cause);
    await sink.abort();

    expect((failed as ExportError).reason).toBe("diskFull");
    expect(await readdir(folder)).toEqual([]);
  });

  it("givenExistingTarget_whenAborted_thenTargetUntouched", async () => {
    const target = join(folder, "keep.csv");
    await writeFile(target, "original\n");
    const sink = await openFileSink(target, "t1");

    await sink.write("x".repeat(SINK_BATCH_BYTES * 2));
    await sink.abort();

    expect(await readFile(target, "utf8")).toBe("original\n");
    expect(await readdir(folder)).toEqual(["keep.csv"]);
  });

  it("givenTwoSinksOnOnePath_whenOpened_thenPartNamesDiffer", async () => {
    const target = join(folder, "same.csv");
    const first = await openFileSink(target, "t1");
    const second = await openFileSink(target, "t2");

    expect(first.partPath).toBe(`${target}.t1.part`);
    expect(second.partPath).toBe(`${target}.t2.part`);
    await first.write("first");
    await second.write("second");
    await first.commit();
    await second.commit();
    expect(await readFile(target, "utf8")).toBe("second");
  });

  it("givenMissingFolder_whenOpened_thenFileErrorWithHint", async () => {
    const failed = await openFileSink(join(folder, "nope", "x.csv"), "t1").catch((cause: unknown) => cause);

    expect((failed as ExportError).reason).toBe("file");
    expect((failed as ExportError).hint).toMatch(/writable/u);
  });
});
