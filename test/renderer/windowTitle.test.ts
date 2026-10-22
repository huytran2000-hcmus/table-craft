import { describe, expect, it } from "vitest";
import { tabCaption, windowTitle } from "@table-craft/desktop/renderer/model/windowTitle.js";

describe("window title", () => {
  it("givenConsoleTab_whenTitled_thenTabThenAppName", () => {
    expect(windowTitle({ title: "console" }, "pg")).toBe("console [pg] — table-craft");
    expect(tabCaption({ title: "console" }, "pg")).toBe("console [pg]");
    expect(windowTitle({ title: "orders" }, null)).toBe("orders — table-craft");
  });

  it("givenNoTab_whenTitled_thenAppNameAlone", () => {
    expect(windowTitle(null, "pg")).toBe("table-craft");
    expect(tabCaption(null, null)).toBeNull();
  });
});
