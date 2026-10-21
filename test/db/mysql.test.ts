import mysql from "@table-craft/plugin-mysql";
import { runPluginContract } from "@table-craft/plugin-api/testing";
import { MYSQL_CONFIG, withWrongPassword } from "../support/databases.js";
import { TYPE_PROBE_EXPECTED } from "../support/typeProbe.js";

runPluginContract(mysql, {
  config: MYSQL_CONFIG,
  wrongPasswordConfig: withWrongPassword(MYSQL_CONFIG),
  statements: { sleep: (seconds) => `SELECT SLEEP(${String(seconds)})` },
  typeProbe: { expected: TYPE_PROBE_EXPECTED },
});
