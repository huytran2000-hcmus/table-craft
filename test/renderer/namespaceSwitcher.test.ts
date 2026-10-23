import { describe, expect, it } from "vitest";
import type { Namespace } from "@table-craft/desktop/engine/protocol.js";
import { switchBlocked, switcherGroups } from "@table-craft/desktop/renderer/model/namespaceSwitcher.js";
import type { ConsoleSession } from "@table-craft/desktop/renderer/state/consoles.js";

function database(name: string, system = false): Namespace {
  return { path: [name], name, kind: "database", system, current: false };
}

const TARGETS = [database("information_schema", true), database("Archive"), database("shop"), database("mysql", true)];

function names(rows: readonly { readonly namespace: Namespace }[]): string[] {
  return rows.map((row) => row.namespace.name);
}

describe("namespace switcher", () => {
  it("givenQuery_whenGrouped_thenFiltersCaseBlind", () => {
    const groups = switcherGroups(TARGETS, null, " arc ");

    expect(names(groups.regular)).toEqual(["Archive"]);
    expect(groups.system).toEqual([]);
  });

  it("givenSystemTargets_whenGrouped_thenSystemGroupLast", () => {
    const groups = switcherGroups(TARGETS, null, "");

    expect(names(groups.regular)).toEqual(["Archive", "shop"]);
    expect(names(groups.system)).toEqual(["information_schema", "mysql"]);
  });

  it("givenCurrent_whenGrouped_thenMarked", () => {
    const groups = switcherGroups(TARGETS, ["shop"], "");

    expect(groups.regular.map((row) => row.current)).toEqual([false, true]);
  });

  it("givenRunningConsole_whenBlocked_thenReason", () => {
    expect(switchBlocked({ status: "running", results: [] })).toMatch(/running/);
    expect(switchBlocked({ status: "connecting", results: [] })).toMatch(/connecting/);
  });

  it("givenFetchingResult_whenBlocked_thenReason", () => {
    const fetching = { kind: "rows", fetching: { rows: 100 } } as unknown as ConsoleSession["results"][number];

    expect(switchBlocked({ status: "ready", results: [fetching] })).toMatch(/fetching/);
  });

  it("givenReadyConsole_whenBlocked_thenNull", () => {
    expect(switchBlocked({ status: "ready", results: [] })).toBeNull();
    expect(switchBlocked({ status: "disconnected", results: [] })).toBeNull();
  });
});
