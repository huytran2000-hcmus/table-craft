import { classifyTokens, namespaceTarget, type SqlDialectOptions } from "@table-craft/plugin-api/sql";
import { describe, expect, it } from "vitest";

const MYSQL: SqlDialectOptions = { backslashEscapes: true, hashComments: true, namespaceStatements: ["use"] };
const POSTGRES: SqlDialectOptions = {
  dollarQuotes: true,
  nestedBlockComments: true,
  namespaceStatements: ["searchPath"],
};

function candidates(sql: string, dialect: SqlDialectOptions): readonly (readonly [string, boolean])[] | null {
  const target = namespaceTarget(sql, dialect);
  return target === null ? null : target.candidates.map((candidate) => [candidate.name, candidate.quoted] as const);
}

describe("namespaceTarget", () => {
  it("givenUseStatement_whenUseFormEnabled_thenTargetsDatabase", () => {
    expect(namespaceTarget("USE archive", MYSQL)).toEqual({
      kind: "database",
      candidates: [{ name: "archive", quoted: false, from: 4, to: 11 }],
    });
    expect(candidates("  use   Archive ;", MYSQL)).toEqual([["Archive", false]]);
    expect(candidates("/* c */ USE archive -- here", MYSQL)).toEqual([["archive", false]]);
  });

  it("givenBacktickedUse_whenParsed_thenCandidateQuoted", () => {
    expect(candidates("USE `My Db`", MYSQL)).toEqual([["My Db", true]]);
    expect(candidates("USE `a``b`", MYSQL)).toEqual([["a`b", true]]);
  });

  it("givenUseWithoutName_whenParsed_thenNull", () => {
    expect(namespaceTarget("USE", MYSQL)).toBeNull();
    expect(namespaceTarget("USE a b", MYSQL)).toBeNull();
  });

  it("givenSearchPathList_whenParsed_thenCandidatesInOrder", () => {
    expect(namespaceTarget("SET search_path TO archive, public", POSTGRES)?.kind).toBe("schema");
    expect(candidates("SET search_path TO archive, public", POSTGRES)).toEqual([
      ["archive", false],
      ["public", false],
    ]);
    expect(candidates('set SESSION search_path = "Archive", public', POSTGRES)).toEqual([
      ["Archive", true],
      ["public", false],
    ]);
    expect(candidates("SET LOCAL SEARCH_PATH TO archive", POSTGRES)).toEqual([["archive", false]]);
  });

  it("givenSearchPathLiteral_whenParsed_thenCandidateQuoted", () => {
    expect(candidates("SET search_path TO 'archive', '$user'", POSTGRES)).toEqual([
      ["archive", true],
      ["$user", true],
    ]);
    expect(candidates("SET search_path TO 'it''s'", POSTGRES)).toEqual([["it's", true]]);
  });

  it("givenSetSchema_whenParsed_thenTargetsSchema", () => {
    expect(namespaceTarget("SET SCHEMA 'archive'", POSTGRES)).toEqual({
      kind: "schema",
      candidates: [{ name: "archive", quoted: true, from: 11, to: 20 }],
    });
    expect(candidates("SET SESSION SCHEMA archive", POSTGRES)).toEqual([["archive", false]]);
  });

  it("givenDefaultOrReset_whenParsed_thenNoCandidates", () => {
    for (const sql of ["SET search_path TO DEFAULT", "SET search_path = default", "RESET search_path", "RESET ALL"]) {
      expect(namespaceTarget(sql, POSTGRES), sql).toEqual({ kind: "schema", candidates: [] });
    }
  });

  it("givenFormNotEnabled_whenParsed_thenNull", () => {
    expect(namespaceTarget("SET search_path TO archive", MYSQL)).toBeNull();
    expect(namespaceTarget("USE archive", POSTGRES)).toBeNull();
    expect(namespaceTarget("USE archive", {})).toBeNull();
  });

  it("givenOtherStatement_whenParsed_thenNull", () => {
    for (const sql of ["SET work_mem TO '64MB'", "RESET work_mem", "SELECT 1", "SET search_path", "", "SET"]) {
      expect(namespaceTarget(sql, POSTGRES), sql).toBeNull();
    }
    expect(namespaceTarget("SET NAMES utf8mb4", MYSQL)).toBeNull();
  });
});

describe("classifyTokens namespace statements", () => {
  it("givenNamespaceStatement_whenClassified_thenSetsNamespace", () => {
    expect(classifyTokens("USE archive", MYSQL)).toEqual({ kind: "other", destructive: null, setsNamespace: true });
    expect(classifyTokens("SET search_path TO archive", POSTGRES).setsNamespace).toBe(true);
    expect(classifyTokens("RESET ALL", POSTGRES).setsNamespace).toBe(true);
    expect(classifyTokens("SET work_mem TO '64MB'", POSTGRES)).toEqual({ kind: "other", destructive: null });
    expect(classifyTokens("USE archive")).toEqual({ kind: "other", destructive: null });
  });
});
