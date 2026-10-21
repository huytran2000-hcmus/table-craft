import { describe, expect, it } from "vitest";
import { datasourceKey, namespaceKey, objectGroupKey } from "@table-craft/desktop/renderer/model/explorerTree.js";
import {
  currentMatch,
  speedSearchMatches,
  startsSpeedSearch,
  stepMatch,
} from "@table-craft/desktop/renderer/model/speedSearch.js";
import { AUDIT_PATH, PUBLIC_PATH, rowsOf } from "./catalogFixtures.js";

describe("speed search", () => {
  it("givenSpeedSearchQuery_whenMatched_thenOnlyLoadedRowsAreSearched", () => {
    const rows = rowsOf({
      expanded: new Set([
        datasourceKey("pg"),
        namespaceKey("pg", ["table_craft"]),
        namespaceKey("pg", AUDIT_PATH),
        namespaceKey("pg", PUBLIC_PATH),
        objectGroupKey("pg", PUBLIC_PATH, "tables"),
        objectGroupKey("pg", PUBLIC_PATH, "views"),
      ]),
    });

    const matches = speedSearchMatches(
      rows.map((row) => row.label),
      "cust",
    );

    expect(matches.map((found) => rows[found.index]?.label)).toEqual(["customers", "customer_totals"]);
    expect(matches[0]?.positions).toEqual([0, 1, 2, 3]);
    expect(matches[1]?.positions).toEqual([0, 1, 2, 3]);
  });

  it("givenSpeedSearchMatches_whenNextPressed_thenWrapsToFirst", () => {
    const matches = speedSearchMatches(["orders", "customers", "audit", "customer_totals"], "cust");

    expect(stepMatch(matches, 1, 1)).toBe(3);
    expect(stepMatch(matches, 3, 1)).toBe(1);
    expect(stepMatch(matches, 1, -1)).toBe(3);
  });

  it("givenSelectedRowStillMatches_whenTyping_thenSelectionStays", () => {
    const matches = speedSearchMatches(["customers", "orders", "customer_totals"], "cu");

    expect(currentMatch(matches, 2)).toBe(2);
    expect(currentMatch(matches, 1)).toBe(2);
  });

  it("givenNoMatch_whenSearched_thenNothingToSelect", () => {
    const matches = speedSearchMatches(["customers", "orders"], "zzz");

    expect(matches).toEqual([]);
    expect(currentMatch(matches, 0)).toBeNull();
  });

  it("givenKeyPress_whenItIsPrintableWithoutModifier_thenItStartsSpeedSearch", () => {
    const key = (value: string, modifiers: Partial<Record<"metaKey" | "ctrlKey" | "altKey", boolean>> = {}) => ({
      key: value,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      ...modifiers,
    });

    expect(startsSpeedSearch(key("c"))).toBe(true);
    expect(startsSpeedSearch(key("C"))).toBe(true);
    expect(startsSpeedSearch(key(" "))).toBe(false);
    expect(startsSpeedSearch(key("ArrowDown"))).toBe(false);
    expect(startsSpeedSearch(key("c", { metaKey: true }))).toBe(false);
  });
});
