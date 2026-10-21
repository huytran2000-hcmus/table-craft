import type { FileSystem } from "@table-craft/desktop/main/files.js";

/** An in-memory `FileSystem` whose next write can be made to die halfway. */
export interface MemoryFiles extends FileSystem {
  readonly contents: Map<string, string>;
  /** The next `writeText` stores half its text, then rejects, as a killed process would leave it. */
  dieDuringNextWrite(): void;
}

export function memoryFiles(initial: Record<string, string> = {}): MemoryFiles {
  const contents = new Map(Object.entries(initial));
  let dying = false;
  return {
    contents,
    dieDuringNextWrite() {
      dying = true;
    },
    readText: (path) => Promise.resolve(contents.get(path) ?? null),
    writeText(path, text) {
      if (dying) {
        dying = false;
        contents.set(path, text.slice(0, Math.floor(text.length / 2)));
        return Promise.reject(new Error("killed mid-write"));
      }
      contents.set(path, text);
      return Promise.resolve();
    },
    rename(from, to) {
      const text = contents.get(from);
      if (text === undefined) return Promise.reject(Object.assign(new Error(`ENOENT: ${from}`), { code: "ENOENT" }));
      contents.delete(from);
      contents.set(to, text);
      return Promise.resolve();
    },
  };
}

/** A `Cipher` that reverses text, with a switch for a keychain that is unavailable or lost. */
export function fakeCipher(): {
  isAvailable(): boolean;
  encrypt(plain: string): string;
  decrypt(cipherText: string): string;
  available: boolean;
  lost: boolean;
} {
  return {
    available: true,
    lost: false,
    isAvailable() {
      return this.available;
    },
    encrypt(plain) {
      return `enc:${[...plain].reverse().join("")}`;
    },
    decrypt(cipherText) {
      if (this.lost) throw new Error("keychain entry missing");
      return [...cipherText.replace(/^enc:/, "")].reverse().join("");
    },
  };
}
