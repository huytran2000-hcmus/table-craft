/**
 * Where `bun run desktop:package:dir` leaves the unpacked app's executable on this host, which
 * `test:smoke:packaged` passes to the smoke harness as `TABLE_CRAFT_APP_EXECUTABLE`.
 * `bun packages/desktop/scripts/packaged-executable.ts` prints it.
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** `productName` in `electron-builder.yml`. */
export const PRODUCT_NAME = "TableCraft";
/** `linux.executableName` in `electron-builder.yml`. */
export const LINUX_EXECUTABLE_NAME = "table-craft";
export const RELEASE_DIRECTORY = join(import.meta.dirname, "..", "release");

/** electron-builder names the unpacked directory by platform, and by architecture unless it is x64. */
export function packagedExecutable(
  platform: NodeJS.Platform,
  arch: string,
  releaseDirectory = RELEASE_DIRECTORY,
): string {
  switch (platform) {
    case "darwin": {
      const directory = arch === "x64" ? "mac" : `mac-${arch}`;
      return join(releaseDirectory, directory, `${PRODUCT_NAME}.app`, "Contents", "MacOS", PRODUCT_NAME);
    }
    case "win32":
      return join(releaseDirectory, arch === "x64" ? "win-unpacked" : `win-${arch}-unpacked`, `${PRODUCT_NAME}.exe`);
    case "linux":
      return join(
        releaseDirectory,
        arch === "x64" ? "linux-unpacked" : `linux-${arch}-unpacked`,
        LINUX_EXECUTABLE_NAME,
      );
    default:
      throw new Error(`TableCraft packages for macOS, Windows and Linux only, not ${platform}.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(packagedExecutable(process.platform, process.arch));
