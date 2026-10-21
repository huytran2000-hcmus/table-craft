/**
 * The file operations the datasource and secret stores need, injected so their tests can fail a
 * write halfway without touching a disk.
 */
export interface FileSystem {
  /** Resolves null when the file does not exist; rejects on any other failure. */
  readText(path: string): Promise<string | null>;
  writeText(path: string, text: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

const TEMPORARY_SUFFIX = ".tmp";

/**
 * Write beside the target, then rename over it. A rename within one directory is atomic, so a
 * process that dies mid-write leaves the previous file whole and a stray `.tmp` behind.
 */
export async function writeAtomically(files: FileSystem, path: string, text: string): Promise<void> {
  const temporary = `${path}${TEMPORARY_SUFFIX}`;
  await files.writeText(temporary, text);
  await files.rename(temporary, path);
}
