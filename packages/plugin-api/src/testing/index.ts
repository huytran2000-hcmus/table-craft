import { describe, expect, it } from "vitest";
import { CAPABILITIES, type DatasourcePlugin, type Row, type Session } from "@table-craft/plugin-api";

export interface ContractFixture {
  /** Configuration that connects to a reachable, writable database. */
  readonly config: unknown;
}

const PROBE_TABLE = "table_craft_contract_probe";
const PROBE_ROWS = 2;

async function collect(rows: AsyncIterable<Row>): Promise<Row[]> {
  const collected: Row[] = [];
  for await (const row of rows) collected.push(row);
  return collected;
}

async function withSession(
  plugin: DatasourcePlugin,
  fixture: ContractFixture,
  use: (session: Session) => Promise<void>,
): Promise<void> {
  const session = await plugin.connect(plugin.connectionSchema.parse(fixture.config));
  try {
    await use(session);
  } finally {
    await session.close();
  }
}

/**
 * The behaviour every plugin owes the host, gated on the capabilities it declares (decision 013).
 * Call it from a Vitest file; it registers one `describe` block.
 */
export function runPluginContract(plugin: DatasourcePlugin, fixture: ContractFixture): void {
  describe(`plugin contract: ${plugin.id}`, () => {
    it("givenPlugin_whenInspected_thenDeclaresOnlyKnownCapabilities", () => {
      for (const capability of plugin.capabilities) expect(CAPABILITIES).toContain(capability);
    });

    it("givenFixtureConfig_whenParsedByConnectionSchema_thenSucceeds", () => {
      expect(plugin.connectionSchema.safeParse(fixture.config).success).toBe(true);
    });

    describe.runIf(plugin.capabilities.includes("sql"))("sql", () => {
      it("givenSession_whenSelectLiterals_thenReturnsColumnsAndOneRow", async () => {
        await withSession(plugin, fixture, async (session) => {
          const result = await session.execute("SELECT 1 AS one, 'two' AS two");
          expect(result.columns.map((column) => column.name)).toEqual(["one", "two"]);
          expect(await collect(result.rows)).toEqual([[1, "two"]]);
        });
      });

      it("givenStatementWithoutRows_whenExecuted_thenReturnsNoColumns", async () => {
        await withSession(plugin, fixture, async (session) => {
          const result = await session.execute(`CREATE TEMPORARY TABLE ${PROBE_TABLE} (n INTEGER)`);
          expect(result.columns).toEqual([]);
          expect(await collect(result.rows)).toEqual([]);
        });
      });

      it("givenInsert_whenExecuted_thenReportsRowsAffected", async () => {
        await withSession(plugin, fixture, async (session) => {
          await session.execute(`CREATE TEMPORARY TABLE ${PROBE_TABLE} (n INTEGER)`);
          const result = await session.execute(`INSERT INTO ${PROBE_TABLE} (n) VALUES (1), (2)`);
          expect(result.rowsAffected).toBe(PROBE_ROWS);
        });
      });

      it("givenInvalidSql_whenExecuted_thenRejects", async () => {
        await withSession(plugin, fixture, async (session) => {
          await expect(session.execute("SELEC 1")).rejects.toThrow();
        });
      });
    });
  });
}
