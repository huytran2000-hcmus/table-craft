import mysql from "@table-craft/plugin-mysql";
import { isPluginError } from "@table-craft/plugin-api";
import { runPluginContract } from "@table-craft/plugin-api/testing";
import { describe, expect, it } from "vitest";
import { MYSQL_CONFIG, withWrongPassword } from "../support/databases.js";
import { MYSQL_MANIFEST } from "../support/manifests.js";
import { TYPE_PROBE_COPY_AS, TYPE_PROBE_EXPECTED, TYPE_PROBE_WRITE } from "../support/typeProbe.js";

runPluginContract(mysql, {
  manifest: MYSQL_MANIFEST,
  config: MYSQL_CONFIG,
  wrongPasswordConfig: withWrongPassword(MYSQL_CONFIG),
  statements: {
    write: TYPE_PROBE_WRITE,
    sleep: (seconds) => `SELECT SLEEP(${String(seconds)})`,
  },
  typeProbe: { expected: TYPE_PROBE_EXPECTED, copyTable: TYPE_PROBE_COPY_AS },
  scripts: [
    {
      text: "DELIMITER //\nCREATE PROCEDURE p() BEGIN SELECT 1; END//\nDELIMITER ;\nCALL p();",
      statements: ["CREATE PROCEDURE p() BEGIN SELECT 1; END", "CALL p()"],
    },
    { text: "SELECT 'it\\'s;' AS s; # a; note\nSELECT 2", statements: ["SELECT 'it\\'s;' AS s", "SELECT 2"] },
  ],
  catalog: {
    path: ["table_craft"],
    quoted: { name: "odd `name`", qualified: "`table_craft`.`odd ``name```" },
    lineItems: "`Line Items`",
    ordersCheck: "orders_total_nonnegative",
    customersComment: "People who place orders",
  },
  namespaceSwitch: { statement: "USE archive", path: ["archive"], missing: "USE no_such_database" },
});

describe("mysql explain", () => {
  it("givenMysqlDelete_whenAnalyseExplainable_thenRefused", async () => {
    const verdict = mysql.language?.explainable?.("DELETE FROM orders WHERE id = 1", { analyze: true });
    expect(verdict).toEqual({
      ok: false,
      reason: "MySQL analyses only SELECT or TABLE statements; use Explain Plan for this DELETE.",
    });
    const session = await mysql.connect(MYSQL_CONFIG, { readOnly: false });
    try {
      const failure: unknown = await session
        .explain?.("DELETE FROM orders WHERE id = 1", { analyze: true })
        .catch((error: unknown) => error);
      expect(isPluginError(failure) && failure.code).toBe("explainUnsupported");
      const plan = await session.explain?.("UPDATE orders SET total = total WHERE id = 1", { analyze: false });
      expect(plan?.statement).toMatch(/^EXPLAIN FORMAT=JSON /);
      expect(plan?.roots[0]).toMatchObject({ operation: "Update", target: "orders" });
    } finally {
      await session.close();
    }
  });
});
