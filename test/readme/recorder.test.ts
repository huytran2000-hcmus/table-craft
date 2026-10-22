import { describe, expect, it } from "vitest";
import { badgeText, playwrightKeys } from "./pace.js";
import { concatList } from "./recorder.js";

describe("README recorder", () => {
  it("givenFrameTimestamps_whenConcatListWritten_thenEachFrameLastsUntilTheNext", () => {
    const list = concatList(
      [
        { file: "frame-00000.png", timestamp: 100 },
        { file: "frame-00001.png", timestamp: 100.25 },
        { file: "frame-00002.png", timestamp: 101 },
      ],
      102.5,
    );

    expect(list.split("\n")).toEqual([
      "ffconcat version 1.0",
      "file 'frame-00000.png'",
      "duration 0.250",
      "file 'frame-00001.png'",
      "duration 0.750",
      "file 'frame-00002.png'",
      "duration 1.500",
      "file 'frame-00002.png'",
      "",
    ]);
  });

  it("givenChord_whenBadgeTextBuilt_thenPlatformGlyphsAreUsed", () => {
    expect(badgeText("Mod+Shift+E", "mac")).toBe("⇧⌘E");
    expect(badgeText("Mod+Shift+E", "other")).toBe("Ctrl+Shift+E");
    expect(badgeText("Shift Shift", "mac")).toBe("⇧⇧");
    expect(playwrightKeys("Mod+Alt+G")).toBe("ControlOrMeta+Alt+G");
  });
});
