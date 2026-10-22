import { describe, expect, it } from "vitest";
import { tabCaption, windowTitle } from "@table-craft/desktop/renderer/model/windowTitle.js";

describe("window title", () => {
  it("givenConsoleTab_whenTitled_thenTabThenAppName", () => {
    expect(windowTitle({ title: "console" }, "pg")).toBe("console [pg] — TableCraft");
    expect(tabCaption({ title: "console" }, "pg")).toBe("console [pg]");
    expect(windowTitle({ title: "orders" }, null)).toBe("orders — TableCraft");
  });

  it("givenNoTab_whenTitled_thenAppNameAlone", () => {
    expect(windowTitle(null, "pg")).toBe("TableCraft");
    expect(tabCaption(null, null)).toBeNull();
  });
});
