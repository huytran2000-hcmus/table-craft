/**
 * The version a build packages as (decision 033): `X.Y.Z` when `HEAD` carries exactly one
 * `vX.Y.Z` tag, else `0.0.0-dev.<short sha>`. The `package.json` files stay `0.0.0`.
 * `bun packages/desktop/scripts/version.ts` prints it.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Runs `git <args>` in the repository and returns its trimmed stdout. */
export type Git = (args: readonly string[]) => string;

const RELEASE_TAG = /^v(\d+\.\d+\.\d+)$/;
const SHORT_SHA_LENGTH = 7;
const DEVELOPMENT_BASE = "0.0.0-dev";

export class VersionError extends Error {
  override readonly name = "VersionError";
}

export function appVersion(git: Git): string {
  const releases = git(["tag", "--points-at", "HEAD"])
    .split("\n")
    .map((tag) => tag.trim())
    .filter((tag) => RELEASE_TAG.test(tag));
  if (releases.length > 1) {
    throw new VersionError(
      `HEAD carries ${releases.length} release tags (${releases.join(", ")}); delete all but one before packaging.`,
    );
  }
  const [release] = releases;
  if (release !== undefined) return release.replace(RELEASE_TAG, "$1");
  return `${DEVELOPMENT_BASE}.${git(["rev-parse", `--short=${SHORT_SHA_LENGTH}`, "HEAD"])}`;
}

export const systemGit: Git = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(appVersion(systemGit));
