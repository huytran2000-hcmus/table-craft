import { describe, expect, it, vi } from "vitest";
import { switchToDatasource, type SwitchToDependencies } from "@table-craft/desktop/renderer/actions/windowActions.js";
import { createTabsStore } from "@table-craft/desktop/renderer/state/tabs.js";

const DATASOURCE_OF: Readonly<Record<string, string>> = {
  "console-pg": "pg",
  "table-pg": "pg",
  "console-mysql": "mysql",
};

function dependencies(recent: readonly string[]) {
  const activate = vi.fn<(tabId: string) => void>();
  const openConsole = vi.fn<(datasourceId: string) => Promise<void>>(() => Promise.resolve());
  const deps: SwitchToDependencies = { recent, datasourceOf: (tabId) => DATASOURCE_OF[tabId], activate, openConsole };
  return { deps, activate, openConsole };
}

describe("datasource.switchTo", () => {
  it("givenOpenConsoleOnDatasource_whenSwitchTo_thenActivatesIt", async () => {
    const { deps, activate, openConsole } = dependencies(["console-mysql", "table-pg", "console-pg"]);

    await switchToDatasource("pg", deps);

    expect(activate).toHaveBeenCalledExactlyOnceWith("table-pg");
    expect(openConsole).not.toHaveBeenCalled();
  });

  it("givenNoTabOnDatasource_whenSwitchTo_thenOpensConsole", async () => {
    const { deps, activate, openConsole } = dependencies(["console-mysql", "ddl-pg"]);

    await switchToDatasource("pg", deps);

    expect(openConsole).toHaveBeenCalledExactlyOnceWith("pg");
    expect(activate).not.toHaveBeenCalled();
  });

  it("givenTabsActivatedInTurn_whenRecencyRead_thenMostRecentFirstAndClosedGone", () => {
    const tabs = createTabsStore();
    for (const id of ["a", "b", "c"]) tabs.getState().open({ id, kind: "console", title: id });
    tabs.getState().activate("a");
    tabs.getState().close("c");

    expect(tabs.getState().recent).toEqual(["a", "b"]);
  });
});
