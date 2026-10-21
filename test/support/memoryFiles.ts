import type { DirectoryFileSystem } from "@table-craft/desktop/main/consoleFiles.js";

const SEPARATOR = "/";

/** An in-memory `DirectoryFileSystem` whose next write can be made to die halfway. Directories are implied by paths. */
export interface MemoryFiles extends DirectoryFileSystem {
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
    listNames(path) {
      const prefix = `${path}${SEPARATOR}`;
      const names = [...contents.keys()]
        .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes(SEPARATOR))
        .map((key) => key.slice(prefix.length));
      return Promise.resolve(names);
    },
    makeDirectory: () => Promise.resolve(),
    remove(path) {
      contents.delete(path);
      return Promise.resolve();
    },
    removeDirectory(path) {
      for (const key of [...contents.keys()]) if (key.startsWith(`${path}${SEPARATOR}`)) contents.delete(key);
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
