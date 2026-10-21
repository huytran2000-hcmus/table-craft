import { describe, expect, it, vi } from "vitest";
import { createActionRegistry, defineAction } from "@table-craft/desktop/renderer/actions/registry.js";
import { IDLE_CONTEXT } from "./support.js";

describe("action registry", () => {
  it("givenTwoActionsWithSameId_whenRegistered_thenThrowsNamingBoth", () => {
    const registry = createActionRegistry(() => IDLE_CONTEXT);
    registry.register([defineAction({ id: "console.run", title: "Run", category: "Console", run: () => undefined })]);

    expect(() =>
      registry.register([
        defineAction({ id: "console.run", title: "Run Again", category: "Console", run: () => undefined }),
      ]),
    ).toThrow(/"console\.run".*"Run".*"Run Again"/);
  });

  it("givenDisabledAction_whenInvoked_thenReturnsDisabledAndDoesNotRun", () => {
    const run = vi.fn();
    const registry = createActionRegistry(() => IDLE_CONTEXT);
    registry.register([defineAction({ id: "console.run", title: "Run", category: "Console", when: () => false, run })]);

    expect(registry.invoke("console.run")).toBe("disabled");
    expect(run).not.toHaveBeenCalled();
  });

  it("givenUnknownId_whenInvoked_thenReturnsUnknown", () => {
    expect(createActionRegistry(() => IDLE_CONTEXT).invoke("nope")).toBe("unknown");
  });

  it("givenEnabledAction_whenInvokedWithArgs_thenRunsOnceWithContextAndArgs", () => {
    const run = vi.fn();
    const registry = createActionRegistry(() => IDLE_CONTEXT);
    registry.register([
      defineAction<{ tabId: string }>({ id: "tab.close", title: "Close Tab", category: "Editor Tabs", run }),
    ]);

    expect(registry.invoke("tab.close", { tabId: "console-1" })).toBe("ran");
    expect(run).toHaveBeenCalledExactlyOnceWith(IDLE_CONTEXT, { tabId: "console-1" });
  });

  it("givenRejectingAction_whenInvoked_thenFailureIsReportedNotThrown", async () => {
    const reported = vi.fn();
    const registry = createActionRegistry(() => IDLE_CONTEXT, reported);
    registry.register([
      defineAction({ id: "boom", title: "Boom", category: "Console", run: () => Promise.reject(new Error("x")) }),
    ]);

    expect(registry.invoke("boom")).toBe("ran");
    await vi.waitFor(() => expect(reported).toHaveBeenCalledWith("boom", expect.any(Error)));
  });
});
