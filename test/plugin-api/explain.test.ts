import {
  ALREADY_EXPLAIN,
  CREATE_TABLE_AS,
  EXPLAIN_ONE_STATEMENT,
  explainedVerb,
  NOTHING_TO_EXPLAIN,
  planPropertyValue,
  planText,
  sqlExplainable,
} from "@table-craft/plugin-api/sql";
import { describe, expect, it } from "vitest";

const { explainable } = sqlExplainable({
  dialect: {},
  name: "Testbase",
  verbs: ["SELECT", "UPDATE", CREATE_TABLE_AS],
  analyzeVerbs: ["SELECT"],
});

describe("sqlExplainable", () => {
  it("givenSharedRefusals_whenExplainable_thenReasonSaysWhatToDo", () => {
    expect(explainable("  -- only a comment", { analyze: false })).toEqual({ ok: false, reason: NOTHING_TO_EXPLAIN });
    expect(explainable("SELECT 1; SELECT 2", { analyze: false })).toEqual({ ok: false, reason: EXPLAIN_ONE_STATEMENT });
    expect(explainable("explain select 1", { analyze: false })).toEqual({ ok: false, reason: ALREADY_EXPLAIN });
    expect(explainable("DESCRIBE orders", { analyze: false })).toEqual({ ok: false, reason: ALREADY_EXPLAIN });
  });

  it("givenVerbTheDialectCannotExplain_whenExplainable_thenNamesItAndTheAlternatives", () => {
    expect(explainable("CREATE TABLE t (id int)", { analyze: false })).toEqual({
      ok: false,
      reason: "Testbase cannot explain a CREATE statement. Explain SELECT, UPDATE or CREATE TABLE … AS instead.",
    });
    expect(explainable("SET x = 1", { analyze: false }).ok).toBe(false);
    expect(explainable("COMMIT", { analyze: false }).ok).toBe(false);
  });

  it("givenCreateTableAs_whenExplainable_thenAcceptedAndWrites", () => {
    expect(explainable("CREATE TABLE t AS SELECT 1", { analyze: false })).toEqual({ ok: true, writes: true });
  });

  it("givenWithSelect_whenExplainable_thenReadNotWrite", () => {
    expect(explainable("WITH x AS (SELECT 1) SELECT * FROM x;", { analyze: true })).toEqual({
      ok: true,
      writes: false,
    });
  });

  it("givenAnalyseOfVerbOutsideAnalyzeVerbs_whenExplainable_thenRefusedNamingThePlainExplain", () => {
    expect(explainable("UPDATE t SET a = 1 WHERE id = 1", { analyze: false })).toEqual({ ok: true, writes: true });
    expect(explainable("UPDATE t SET a = 1 WHERE id = 1", { analyze: true })).toEqual({
      ok: false,
      reason: "Testbase analyses only SELECT statements; use Explain Plan for this UPDATE.",
    });
  });

  it("givenNoAnalyzeVerbs_whenAnalyseExplainable_thenRefused", () => {
    const none = sqlExplainable({ dialect: {}, name: "Lite", verbs: ["SELECT"], analyzeVerbs: [] }).explainable;
    expect(none("SELECT 1", { analyze: true })).toEqual({
      ok: false,
      reason: "Lite cannot run Explain Analyse; use Explain Plan.",
    });
  });

  it("givenStatements_whenVerbRead_thenMainVerb", () => {
    expect(explainedVerb("with x as (select 1) delete from t", {})).toBe("DELETE");
    expect(explainedVerb("CREATE TEMPORARY TABLE t AS SELECT 1", {})).toBe(CREATE_TABLE_AS);
  });
});

describe("plan helpers", () => {
  it("givenRows_whenPlanText_thenFirstCellsOnePerLine", () => {
    expect(planText([["-> a"], [{ kind: "json", text: "[]" }], [null]])).toBe("-> a\n[]\n");
  });

  it("givenValues_whenPlanPropertyValue_thenOneLine", () => {
    expect(planPropertyValue(["a", "b"])).toBe("a, b");
    expect(planPropertyValue([])).toBeNull();
    expect(planPropertyValue(1.5)).toBe("1.5");
    expect(planPropertyValue({ a: 1 })).toBe('{"a":1}');
  });
});
