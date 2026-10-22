/**
 * Runs electron-builder for this host's platform and architecture with the version from git
 * (decision 033), never publishing. `--dir` builds only the unpacked app the packaged smoke suite
 * launches; `--x64` or `--arm64` overrides the architecture, e.g. an x64 DMG on Apple silicon.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { appVersion, systemGit } from "./version.js";

const PACKAGE_ROOT = join(import.meta.dirname, "..");
const PLATFORM_FLAGS: Partial<Record<NodeJS.Platform, string>> = { darwin: "--mac", win32: "--win", linux: "--linux" };
const ARCH_FLAGS = ["--x64", "--arm64"];
/** electron-builder's certificate variables; nothing in this repository sets them. */
const DEVELOPER_ID_VARIABLES = ["CSC_LINK", "CSC_NAME"];
/**
 * `-` signs ad hoc, so the arm64 app launches at all. The hardened runtime goes with it: its
 * library validation rejects the ad-hoc-signed Electron Framework, whose Team ID is empty.
 */
const AD_HOC_SIGNING = ["-c.mac.identity=-", "-c.mac.hardenedRuntime=false"];

function hasDeveloperId(env: NodeJS.ProcessEnv): boolean {
  return DEVELOPER_ID_VARIABLES.some((name) => (env[name] ?? "") !== "");
}

const passed = process.argv.slice(2);
const platform = PLATFORM_FLAGS[process.platform];
if (platform === undefined)
  throw new Error(`table-craft packages on macOS, Windows and Linux only, not ${process.platform}.`);
const arch = passed.some((flag) => ARCH_FLAGS.includes(flag)) ? [] : [`--${process.arch}`];
const version = appVersion(systemGit);
const args = [
  "--config",
  "electron-builder.yml",
  platform,
  ...arch,
  ...passed,
  `-c.extraMetadata.version=${version}`,
  ...(process.platform === "darwin" && !hasDeveloperId(process.env) ? AD_HOC_SIGNING : []),
  "--publish",
  "never",
];

console.log(`electron-builder ${args.join(" ")}`);
// The shell finds electron-builder's `.cmd` shim on Windows; `bun run` puts it on PATH.
const result = spawnSync("electron-builder", args, { cwd: PACKAGE_ROOT, stdio: "inherit", shell: true });
process.exit(result.status ?? 1);
