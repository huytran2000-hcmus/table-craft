import { isCompatible } from "@table-craft/plugin-api";
import { describe, expect, it } from "vitest";

describe("isCompatible", () => {
  it.each([
    ["0.1.0", "0.1.0", true],
    ["0.1.0", "0.1.3", true],
    ["0.1.4", "0.1.3", false],
    ["0.1.0", "0.2.0", false],
    ["1.2.0", "1.4.1", true],
    ["1.5.0", "1.4.1", false],
    ["1.0.0", "2.0.0", false],
    ["v0.1.0", "0.1.0", false],
  ])("givenPlugin%sAndHost%s_whenChecked_thenCompatibleIs%s", (plugin, host, expected) => {
    expect(isCompatible(plugin, host)).toBe(expected);
  });
});
