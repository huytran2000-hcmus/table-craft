import { crc32, inflateRawSync } from "node:zlib";

/** One entry as the central directory describes it, its data inflated and its CRC checked. */
export interface ZipEntry {
  readonly name: string;
  readonly compressed: number;
  readonly uncompressed: number;
  readonly offset: number;
  readonly zip64: boolean;
  readonly text: () => string;
}

export interface ZipArchive {
  readonly entries: readonly ZipEntry[];
  readonly zip64End: boolean;
}

const END_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_END_SIGNATURE = 0x06064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP32_MAX = 0xffffffff;
const ZIP16_MAX = 0xffff;

/** A ZIP reader independent of the writer under test: it trusts only the central directory. */
export function readZip(bytes: Uint8Array): ZipArchive {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.byteLength - 22;
  while (end >= 0 && view.getUint32(end, true) !== END_SIGNATURE) end -= 1;
  if (end < 0) throw new Error("No end of central directory record.");
  let count = view.getUint16(end + 10, true);
  let directorySize = view.getUint32(end + 12, true);
  let directoryOffset = view.getUint32(end + 16, true);
  let zip64End = false;
  if (count === ZIP16_MAX || directorySize === ZIP32_MAX || directoryOffset === ZIP32_MAX) {
    const locator = end - 20;
    if (view.getUint32(locator, true) !== ZIP64_LOCATOR_SIGNATURE) throw new Error("No Zip64 locator.");
    const record = Number(view.getBigUint64(locator + 8, true));
    if (view.getUint32(record, true) !== ZIP64_END_SIGNATURE) throw new Error("No Zip64 end record.");
    count = Number(view.getBigUint64(record + 32, true));
    directorySize = Number(view.getBigUint64(record + 40, true));
    directoryOffset = Number(view.getBigUint64(record + 48, true));
    zip64End = true;
  }
  const entries: ZipEntry[] = [];
  let at = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(at, true) !== CENTRAL_SIGNATURE) throw new Error(`Bad central header ${String(index)}.`);
    const crc = view.getUint32(at + 16, true);
    let compressed = view.getUint32(at + 20, true);
    let uncompressed = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    let offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    let zip64 = false;
    let extra = at + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra < extraEnd) {
      const id = view.getUint16(extra, true);
      const size = view.getUint16(extra + 2, true);
      if (id === 1) {
        zip64 = true;
        let field = extra + 4;
        if (uncompressed === ZIP32_MAX) {
          uncompressed = Number(view.getBigUint64(field, true));
          field += 8;
        }
        if (compressed === ZIP32_MAX) {
          compressed = Number(view.getBigUint64(field, true));
          field += 8;
        }
        if (offset === ZIP32_MAX) offset = Number(view.getBigUint64(field, true));
      }
      extra += 4 + size;
    }
    if (view.getUint32(offset, true) !== LOCAL_SIGNATURE) throw new Error(`Bad local header for ${name}.`);
    const dataStart = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    const data = bytes.subarray(dataStart, dataStart + compressed);
    entries.push({
      name,
      compressed,
      uncompressed,
      offset,
      zip64,
      text: () => {
        const inflated = inflateRawSync(data);
        if (inflated.byteLength !== uncompressed) throw new Error(`${name}: size ${String(inflated.byteLength)}.`);
        if (crc32(inflated) !== crc) throw new Error(`${name}: CRC mismatch.`);
        return inflated.toString("utf8");
      },
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  if (at !== directoryOffset + directorySize) throw new Error("Central directory size mismatch.");
  return { entries, zip64End };
}
