import postgres from "@table-craft/plugin-postgres";
import { runPluginContract } from "@table-craft/plugin-api/testing";
import { POSTGRES_CONFIG, withWrongPassword } from "../support/databases.js";
import { TYPE_PROBE_EXPECTED } from "../support/typeProbe.js";

runPluginContract(postgres, {
  config: POSTGRES_CONFIG,
  wrongPasswordConfig: withWrongPassword(POSTGRES_CONFIG),
  statements: { sleep: (seconds) => `SELECT pg_sleep(${String(seconds)})` },
  typeProbe: { expected: TYPE_PROBE_EXPECTED },
});
