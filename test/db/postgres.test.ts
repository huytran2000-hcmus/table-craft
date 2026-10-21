import postgres from "@table-craft/plugin-postgres";
import { runPluginContract } from "@table-craft/plugin-api/testing";
import { POSTGRES_CONFIG, withWrongPassword } from "../support/databases.js";
import { POSTGRES_MANIFEST } from "../support/manifests.js";
import { TYPE_PROBE_EXPECTED, TYPE_PROBE_WRITE } from "../support/typeProbe.js";

runPluginContract(postgres, {
  manifest: POSTGRES_MANIFEST,
  config: POSTGRES_CONFIG,
  wrongPasswordConfig: withWrongPassword(POSTGRES_CONFIG),
  statements: {
    write: TYPE_PROBE_WRITE,
    sleep: (seconds) => `SELECT pg_sleep(${String(seconds)})`,
  },
  typeProbe: { expected: TYPE_PROBE_EXPECTED },
  catalog: {
    path: ["table_craft", "public"],
    quoted: { name: 'odd "name"', qualified: '"public"."odd ""name"""' },
  },
});
