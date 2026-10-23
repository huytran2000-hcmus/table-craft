import { TextDecoder } from "node:util";
import type { ImportEncoding } from "@table-craft/core/import/format.js";

type Concrete = Exclude<ImportEncoding, "auto">;

const BOMS: readonly { readonly bytes: readonly number[]; readonly encoding: Concrete }[] = [
  { bytes: [0xef, 0xbb, 0xbf], encoding: "utf-8" },
  { bytes: [0xff, 0xfe], encoding: "utf-16le" },
  { bytes: [0xfe, 0xff], encoding: "utf-16be" },
];
const LONGEST_BOM = 3;

/** Bytes in, text out, across chunk boundaries (plan 021, ruling 2). */
export interface ImportDecoder {
  /** Text the bytes complete; a character split across chunks waits for the next one. */
  push(bytes: Uint8Array): string;
  end(): string;
  /** The encoding read with, once known: `auto` resolves on the first bytes. */
  readonly encoding: Concrete | null;
}

export class DecodeError extends Error {
  override readonly name = "DecodeError";
}

function sniff(head: Uint8Array): Concrete {
  for (const bom of BOMS) {
    if (bom.bytes.every((byte, index) => head[index] === byte)) return bom.encoding;
  }
  return "utf-8";
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const joined = new Uint8Array(left.length + right.length);
  joined.set(left);
  joined.set(right, left.length);
  return joined;
}

/**
 * A streaming decoder. A byte-order mark is dropped; `auto` picks the encoding from it, UTF-8
 * without one. UTF-8 and UTF-16 are decoded strictly, so a file in another encoding fails with a
 * `DecodeError` instead of importing replacement characters.
 */
export function importDecoder(encoding: ImportEncoding): ImportDecoder {
  let decoder: TextDecoder | null = null;
  let resolved: Concrete | null = encoding === "auto" ? null : encoding;
  let pending: Uint8Array = new Uint8Array(0);

  function open(chosen: Concrete): TextDecoder {
    resolved = chosen;
    return new TextDecoder(chosen, { fatal: chosen !== "windows-1252" });
  }

  function decode(bytes: Uint8Array, stream: boolean): string {
    try {
      decoder ??= open(resolved ?? sniff(bytes));
      return decoder.decode(bytes, { stream });
    } catch (cause) {
      throw new DecodeError(`The file is not valid ${resolved ?? "UTF-8"} text; choose the file's encoding.`, {
        cause,
      });
    }
  }

  return {
    get encoding() {
      return resolved;
    },
    push(bytes) {
      if (decoder === null && resolved === null) {
        pending = concat(pending, bytes);
        if (pending.length < LONGEST_BOM) return "";
        const head = pending;
        pending = new Uint8Array(0);
        return decode(head, true);
      }
      return decode(bytes, true);
    },
    end() {
      const rest = pending;
      pending = new Uint8Array(0);
      return decode(rest, false);
    },
  };
}
