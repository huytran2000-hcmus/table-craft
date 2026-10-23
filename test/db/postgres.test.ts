import postgres from "@table-craft/plugin-postgres";
import { runPluginContract } from "@table-craft/plugin-api/testing";
import { describe, expect, it } from "vitest";
import { POSTGRES_CONFIG, withWrongPassword } from "../support/databases.js";
import { POSTGRES_MANIFEST } from "../support/manifests.js";
import { TYPE_PROBE_COPY_AS, TYPE_PROBE_EXPECTED, TYPE_PROBE_WRITE } from "../support/typeProbe.js";

runPluginContract(postgres, {
  manifest: POSTGRES_MANIFEST,
  config: POSTGRES_CONFIG,
  wrongPasswordConfig: withWrongPassword(POSTGRES_CONFIG),
  statements: {
    write: TYPE_PROBE_WRITE,
    sleep: (seconds) => `SELECT pg_sleep(${String(seconds)})`,
  },
  typeProbe: { expected: TYPE_PROBE_EXPECTED, copyTable: TYPE_PROBE_COPY_AS },
  scripts: [
    {
      text: "CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql;\nSELECT f();",
      statements: ["CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql", "SELECT f()"],
    },
    { text: "/* a /* nested; */ comment; */ SELECT 1; SELECT $1", statements: ["SELECT 1", "SELECT $1"] },
  ],
  catalog: {
    path: ["table_craft", "public"],
    quoted: { name: 'odd "name"', qualified: '"public"."odd ""name"""' },
    lineItems: '"Line Items"',
    ordersCheck: "orders_total_nonnegative",
    customersComment: "People who place orders",
  },
  namespaceSwitch: { statement: "SET search_path TO archive, public", path: ["table_craft", "archive"] },
});

describe("postgres current namespace", () => {
  it("givenSearchPathOfNoSchema_whenRead_thenNull", async () => {
    const session = await postgres.connect(POSTGRES_CONFIG, { readOnly: false });
    try {
      await session.execute("SET search_path TO no_such_schema");
      expect(await session.currentNamespace?.()).toBeNull();
    } finally {
      await session.close();
    }
  });

  it("givenSetLocalInTransaction_whenRolledBack_thenNamespaceReverts", async () => {
    const session = await postgres.connect(POSTGRES_CONFIG, { readOnly: false });
    try {
      await session.transactions?.setMode("manual");
      await session.execute("SET LOCAL search_path TO archive");
      expect(await session.currentNamespace?.()).toEqual(["table_craft", "archive"]);
      await session.transactions?.rollback();
      expect(await session.currentNamespace?.()).toEqual(["table_craft", "public"]);
    } finally {
      await session.close();
    }
  });
});
