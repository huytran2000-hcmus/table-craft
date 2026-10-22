import mysql from "@table-craft/plugin-mysql";
import { runPluginContract } from "@table-craft/plugin-api/testing";
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
});
