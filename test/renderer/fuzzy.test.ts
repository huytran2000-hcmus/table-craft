import { describe, expect, it } from "vitest";
import { match, score } from "@table-craft/desktop/renderer/model/fuzzy.js";

function ranked(query: string, titles: readonly string[]): readonly string[] {
  return titles
    .map((title) => ({ title, score: score(query, title) }))
    .filter((entry): entry is { title: string; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.title);
}

describe("fuzzy score", () => {
  it("givenQueryNc_whenScored_thenNewConsoleRanksAboveCancel", () => {
    expect(ranked("nc", ["Cancel", "New Console"])).toEqual(["New Console", "Cancel"]);
  });

  it("givenCharactersOutOfOrder_whenScored_thenNoMatch", () => {
    expect(score("cn", "New Console")).not.toBeNull();
    expect(score("xyz", "New Console")).toBeNull();
    expect(score("lone", "Console")).toBeNull();
  });

  it("givenSpacedQuery_whenScored_thenSpacesAreIgnored", () => {
    expect(ranked("new con", ["Close Tab", "New Console", "Select Next Tab"])).toEqual(["New Console"]);
  });

  it("givenPrefixAndScatteredMatch_whenScored_thenPrefixWins", () => {
    expect(ranked("se", ["Close Tab", "Services", "Search Everywhere"])).toEqual([
      "Search Everywhere",
      "Services",
      "Close Tab",
    ]);
  });

  it("givenEmptyQuery_whenScored_thenEverythingMatchesEqually", () => {
    expect(score("", "Anything")).toBe(0);
  });

  it("givenWordStarts_whenMatched_thenPositionsFollowTheBestScore", () => {
    expect(match("ord", "orders")?.positions).toEqual([0, 1, 2]);
    expect(match("ct", "customer_totals")?.positions).toEqual([0, 9]);
  });

  it("givenNoMatch_whenMatched_thenNull", () => {
    expect(match("zz", "orders")).toBeNull();
  });
});
