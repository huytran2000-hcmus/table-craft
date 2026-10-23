import { killStatementFor } from "@table-craft/plugin-mysql/server";
import { describe, expect, it } from "vitest";

const CONNECTION_ID = 42;

describe("mysql kill statement", () => {
  it("givenMysql_whenKillStatement_thenKillQuery", () => {
    expect(killStatementFor("8.4.3", CONNECTION_ID)).toBe("KILL QUERY 42");
  });

  it("givenUnknownVersion_whenKillStatement_thenKillQuery", () => {
    expect(killStatementFor(null, CONNECTION_ID)).toBe("KILL QUERY 42");
  });

  it("givenTidbWithGlobalKill_whenKillStatement_thenKillTidbQuery", () => {
    expect(killStatementFor("8.0.11-TiDB-v6.1.0", CONNECTION_ID)).toBe("KILL TIDB QUERY 42");
    expect(killStatementFor("8.0.11-TiDB-v7.5.1", CONNECTION_ID)).toBe("KILL TIDB QUERY 42");
  });

  it("givenTidbBeforeGlobalKill_whenKillStatement_thenNone", () => {
    expect(killStatementFor("5.7.25-TiDB-v4.0.14", CONNECTION_ID)).toBeNull();
    expect(killStatementFor("5.7.25-TiDB-v6.0.0", CONNECTION_ID)).toBeNull();
  });
});
