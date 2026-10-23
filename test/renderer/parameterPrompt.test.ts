import { describe, expect, it } from "vitest";
import type { ClassifiedStatement, StatementParameter } from "@table-craft/desktop/engine/protocol.js";
import {
  parameterPrompt,
  parametersAnswer,
  parseParametersAnswer,
  shownValue,
  valuesFor,
} from "@table-craft/desktop/renderer/model/parameters.js";

function statement(sql: string, parameters: readonly StatementParameter[]): ClassifiedStatement {
  return { from: 0, to: sql.length, sql, kind: "read", destructive: null, parameters };
}

function positional(n: number, from: number): StatementParameter {
  return { name: `?${String(n)}`, from, to: from + 1, style: "positional" };
}

function named(name: string, from: number): StatementParameter {
  return { name, from, to: from + name.length, style: "named" };
}

describe("parameter prompt", () => {
  it("givenScript_whenPrompted_thenQuestionMarksNumberedAcrossStatements", () => {
    const first = statement("SELECT ?, ?", [positional(1, 7), positional(2, 10)]);
    const second = statement("SELECT ?", [positional(1, 7)]);

    const prompt = parameterPrompt([first, second]);

    expect(prompt.names).toEqual(["?1", "?2", "?3"]);
    expect(valuesFor(prompt.statements[1]!, { "?1": "a", "?2": "b", "?3": "c" })).toEqual({ "?1": "c" });
  });

  it("givenNameInTwoStatements_whenPrompted_thenOneRowSharedByBoth", () => {
    const prompt = parameterPrompt([
      statement("SELECT :id", [named(":id", 7)]),
      statement("DELETE FROM t WHERE id = :id AND :id > 0", [named(":id", 25), named(":id", 33)]),
    ]);

    expect(prompt.names).toEqual([":id"]);
    expect(prompt.statements.map((one) => valuesFor(one, { ":id": "3" }))).toEqual([{ ":id": "3" }, { ":id": "3" }]);
  });

  it("givenStatementWithoutParameters_whenValuesAsked_thenUndefined", () => {
    const prompt = parameterPrompt([statement("SELECT 1", [])]);

    expect(prompt.names).toEqual([]);
    expect(valuesFor(prompt.statements[0]!, {})).toBeUndefined();
  });

  // Regression: the dialog read `values[name] ?? ""`, so ticking NULL never stuck (live test, plan 019).
  it("givenNullValue_whenShown_thenStaysNullAndMissingIsEmpty", () => {
    expect(shownValue({ ":v": null }, ":v")).toBeNull();
    expect(shownValue({}, ":v")).toBe("");
    expect(shownValue({ ":v": "x" }, ":v")).toBe("x");
  });

  it("givenNullValue_whenAnswered_thenRoundTripsAsNull", () => {
    expect(parseParametersAnswer(parametersAnswer({ ":a": null, ":b": "x" }))).toEqual({ ":a": null, ":b": "x" });
  });
});
