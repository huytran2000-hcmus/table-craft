import { constants, crc32, deflateRawSync } from "node:zlib";

/**
 * A streaming ZIP writer (decision 041): each entry is deflated chunk by chunk and closed with a
 * data descriptor, so nothing of an entry is held but the chunk in hand. Zip64 records appear only
 * where a size or offset reaches the 32-bit limit, so a small workbook is a plain ZIP.
 */
export interface ZipWriter {
  /** The local header of a new entry; the previous one must be finished. */
  begin(name: string): Uint8Array;
  /** `chunk` of the open entry, compressed; may be empty. */
  data(chunk: Uint8Array): Uint8Array;
  /** The rest of the open entry and its data descriptor. */
  finish(): Uint8Array;
  /** The central directory and end records. */
  close(): Uint8Array;
}

export interface ZipOptions {
  /** Sizes and offsets at or above this use Zip64 records. Lowered only by tests. */
  readonly zip64Limit?: number;
  readonly level?: number;
  readonly modified?: Date;
}

/** The largest value a 32-bit ZIP field holds; it doubles as the "see the Zip64 field" marker. */
export const ZIP32_MAX = 0xffff_ffff;
const ZIP16_MAX = 0xffff;

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const ZIP64_END_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const END_SIGNATURE = 0x06054b50;
const ZIP64_EXTRA_ID = 0x0001;

const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const DESCRIPTOR_BYTES = 16;
const ZIP64_DESCRIPTOR_BYTES = 24;
const ZIP64_END_BYTES = 56;
const ZIP64_LOCATOR_BYTES = 20;
const END_BYTES = 22;
/** The Zip64 end record's size field counts what follows its first 12 bytes. */
const ZIP64_END_TAIL_BYTES = ZIP64_END_BYTES - 12;
const EXTRA_HEADER_BYTES = 4;
const UINT64_BYTES = 8;

const VERSION_DEFLATE = 20;
const VERSION_ZIP64 = 45;
/** Bit 3: sizes follow in a data descriptor. Bit 11: the name is UTF-8. */
const FLAGS = 0x0808;
const METHOD_DEFLATE = 8;

const DOS_YEAR_BASE = 1980;
const DOS_YEAR_SHIFT = 9;
const DOS_MONTH_SHIFT = 5;
const DOS_HOUR_SHIFT = 11;
const DOS_MINUTE_SHIFT = 5;
const DOS_SECONDS_STEP = 2;

interface Entry {
  readonly name: Uint8Array;
  readonly offset: number;
  crc: number;
  compressed: number;
  uncompressed: number;
}

function dosTime(date: Date): { time: number; date: number } {
  return {
    time:
      (date.getHours() << DOS_HOUR_SHIFT) |
      (date.getMinutes() << DOS_MINUTE_SHIFT) |
      Math.floor(date.getSeconds() / DOS_SECONDS_STEP),
    date:
      ((Math.max(date.getFullYear(), DOS_YEAR_BASE) - DOS_YEAR_BASE) << DOS_YEAR_SHIFT) |
      ((date.getMonth() + 1) << DOS_MONTH_SHIFT) |
      date.getDate(),
  };
}

class Bytes {
  readonly buffer: Uint8Array;
  readonly view: DataView;
  offset = 0;

  constructor(size: number) {
    this.buffer = new Uint8Array(size);
    this.view = new DataView(this.buffer.buffer);
  }

  u16(value: number): this {
    this.view.setUint16(this.offset, value, true);
    this.offset += 2;
    return this;
  }

  u32(value: number): this {
    this.view.setUint32(this.offset, value >>> 0, true);
    this.offset += 4;
    return this;
  }

  u64(value: number): this {
    this.view.setBigUint64(this.offset, BigInt(value), true);
    this.offset += UINT64_BYTES;
    return this;
  }

  raw(bytes: Uint8Array): this {
    this.buffer.set(bytes, this.offset);
    this.offset += bytes.byteLength;
    return this;
  }
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

export function zipWriter(options: ZipOptions = {}): ZipWriter {
  const limit = options.zip64Limit ?? ZIP32_MAX;
  const level = options.level ?? constants.Z_BEST_SPEED;
  const stamp = dosTime(options.modified ?? new Date());
  const encoder = new TextEncoder();
  const entries: Entry[] = [];
  let open: Entry | null = null;
  let written = 0;

  function emit(bytes: Uint8Array): Uint8Array {
    written += bytes.byteLength;
    return bytes;
  }

  function current(): Entry {
    if (open === null) throw new Error("No ZIP entry is open.");
    return open;
  }

  return {
    begin(name) {
      if (open !== null) throw new Error(`ZIP entry ${new TextDecoder().decode(open.name)} is still open.`);
      const encoded = encoder.encode(name);
      open = { name: encoded, offset: written, crc: 0, compressed: 0, uncompressed: 0 };
      const header = new Bytes(LOCAL_HEADER_BYTES + encoded.byteLength)
        .u32(LOCAL_HEADER_SIGNATURE)
        // Excel rejects a streamed entry whose local header claims ZIP64 while its descriptor is
        // 32-bit; the central directory says ZIP64 for the entries that need it.
        .u16(VERSION_DEFLATE)
        .u16(FLAGS)
        .u16(METHOD_DEFLATE)
        .u16(stamp.time)
        .u16(stamp.date)
        .u32(0)
        .u32(0)
        .u32(0)
        .u16(encoded.byteLength)
        .u16(0)
        .raw(encoded);
      return emit(header.buffer);
    },
    data(chunk) {
      const entry = current();
      if (chunk.byteLength === 0) return new Uint8Array(0);
      entry.crc = crc32(chunk, entry.crc);
      entry.uncompressed += chunk.byteLength;
      // A sync flush ends the block without the final bit, so the pieces join into one stream.
      const deflated = deflateRawSync(chunk, { level, finishFlush: constants.Z_SYNC_FLUSH });
      entry.compressed += deflated.byteLength;
      return emit(deflated);
    },
    finish() {
      const entry = current();
      const last = deflateRawSync(new Uint8Array(0), { level });
      entry.compressed += last.byteLength;
      const zip64 = entry.compressed >= limit || entry.uncompressed >= limit;
      const descriptor = new Bytes(zip64 ? ZIP64_DESCRIPTOR_BYTES : DESCRIPTOR_BYTES)
        .u32(DATA_DESCRIPTOR_SIGNATURE)
        .u32(entry.crc);
      if (zip64) descriptor.u64(entry.compressed).u64(entry.uncompressed);
      else descriptor.u32(entry.compressed).u32(entry.uncompressed);
      entries.push(entry);
      open = null;
      return emit(concat([last, descriptor.buffer]));
    },
    close() {
      if (open !== null) throw new Error("A ZIP entry is still open.");
      const directoryOffset = written;
      const headers = entries.map((entry) => {
        const big = {
          uncompressed: entry.uncompressed >= limit,
          compressed: entry.compressed >= limit,
          offset: entry.offset >= limit,
        };
        const extraFields = [big.uncompressed, big.compressed, big.offset].filter(Boolean).length;
        const extraBytes = extraFields === 0 ? 0 : EXTRA_HEADER_BYTES + extraFields * UINT64_BYTES;
        const header = new Bytes(CENTRAL_HEADER_BYTES + entry.name.byteLength + extraBytes)
          .u32(CENTRAL_HEADER_SIGNATURE)
          .u16(VERSION_ZIP64)
          .u16(extraFields === 0 ? VERSION_DEFLATE : VERSION_ZIP64)
          .u16(FLAGS)
          .u16(METHOD_DEFLATE)
          .u16(stamp.time)
          .u16(stamp.date)
          .u32(entry.crc)
          .u32(big.compressed ? ZIP32_MAX : entry.compressed)
          .u32(big.uncompressed ? ZIP32_MAX : entry.uncompressed)
          .u16(entry.name.byteLength)
          .u16(extraBytes)
          .u16(0)
          .u16(0)
          .u16(0)
          .u32(0)
          .u32(big.offset ? ZIP32_MAX : entry.offset)
          .raw(entry.name);
        if (extraFields > 0) {
          header.u16(ZIP64_EXTRA_ID).u16(extraBytes - EXTRA_HEADER_BYTES);
          if (big.uncompressed) header.u64(entry.uncompressed);
          if (big.compressed) header.u64(entry.compressed);
          if (big.offset) header.u64(entry.offset);
        }
        return header.buffer;
      });
      const directory = concat(headers);
      const directorySize = directory.byteLength;
      const zip64 = entries.length >= ZIP16_MAX || directoryOffset >= limit || directorySize >= limit;
      const tail: Uint8Array[] = [directory];
      if (zip64) {
        const zip64EndOffset = directoryOffset + directorySize;
        tail.push(
          new Bytes(ZIP64_END_BYTES)
            .u32(ZIP64_END_SIGNATURE)
            .u64(ZIP64_END_TAIL_BYTES)
            .u16(VERSION_ZIP64)
            .u16(VERSION_ZIP64)
            .u32(0)
            .u32(0)
            .u64(entries.length)
            .u64(entries.length)
            .u64(directorySize)
            .u64(directoryOffset).buffer,
          new Bytes(ZIP64_LOCATOR_BYTES).u32(ZIP64_LOCATOR_SIGNATURE).u32(0).u64(zip64EndOffset).u32(1).buffer,
        );
      }
      tail.push(
        new Bytes(END_BYTES)
          .u32(END_SIGNATURE)
          .u16(0)
          .u16(0)
          .u16(zip64 ? ZIP16_MAX : entries.length)
          .u16(zip64 ? ZIP16_MAX : entries.length)
          .u32(zip64 ? ZIP32_MAX : directorySize)
          .u32(zip64 ? ZIP32_MAX : directoryOffset)
          .u16(0).buffer,
      );
      return emit(concat(tail));
    },
  };
}
