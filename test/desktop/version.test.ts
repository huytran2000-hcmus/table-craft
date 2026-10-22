import { describe, expect, it } from "vitest";
import { appVersion, VersionError } from "../../packages/desktop/scripts/version.js";
import type { Git } from "../../packages/desktop/scripts/version.js";

const SHORT_SHA = "8379c80";

function gitWithTags(...tags: string[]): Git {
  return (args) => {
    if (args[0] === "tag") return tags.join("\n");
    if (args[0] === "rev-parse") return SHORT_SHA;
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
}

describe("app version", () => {
  it("givenTaggedHead_whenVersionComputed_thenTagWithoutV", () => {
    expect(appVersion(gitWithTags("v1.2.3"))).toBe("1.2.3");
  });

  it("givenUntaggedHead_whenVersionComputed_thenDevPrereleaseWithSha", () => {
    expect(appVersion(gitWithTags())).toBe(`0.0.0-dev.${SHORT_SHA}`);
  });

  it("givenNonReleaseTagOnHead_whenVersionComputed_thenDevPrereleaseWithSha", () => {
    expect(appVersion(gitWithTags("nightly", "v1.2"))).toBe(`0.0.0-dev.${SHORT_SHA}`);
  });

  it("givenTwoTagsOnHead_whenVersionComputed_thenFailsNamingBoth", () => {
    const compute = () => appVersion(gitWithTags("v1.0.0", "v1.0.1"));

    expect(compute).toThrow(VersionError);
    expect(compute).toThrow(/v1\.0\.0, v1\.0\.1/);
  });
});
