import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  isPluginError,
  z,
  type ConnectOptions,
  type DatasourcePlugin,
  type PluginErrorCode,
  type PluginManifest,
  type Row,
  type Session,
} from "@table-craft/plugin-api";

export interface ContractFixture {
  /** The plugin's parsed `table-craft-plugin.json`, whose connection form the suite checks. */
  readonly manifest: PluginManifest;
  /** Configuration that connects to a reachable, writable database seeded with `TYPE_PROBE_TABLE`. */
  readonly config: unknown;
  /** The same database with a wrong password; omitted by plugins that do not authenticate. */
  readonly wrongPasswordConfig?: unknown;
  readonly statements?: {
    /** A statement that runs for `seconds`; required when the plugin declares `cancel`. */
    readonly sleep?: (seconds: number) => string;
    /**
     * A write that succeeds on a writable session and leaves the fixture unchanged, such as an
     * update setting a column to itself; the read-only case is skipped without one.
     */
    readonly write?: string;
  };
  readonly typeProbe: {
    /** The rows of `SELECT * FROM type_probe ORDER BY id`, as wire values. */
    readonly expected: readonly Row[];
  };
}

/** The table every fixture database carries, one column per value rule the contract pins. */
export const TYPE_PROBE_TABLE = "type_probe";

export const TYPE_PROBE_COLUMNS = [
  "id",
  "small_int",
  "big_int",
  "exact_decimal",
  "unicode_text",
  "flag",
  "doc",
  "payload",
  "day",
  "moment",
] as const;

const PROBE_TABLE = "table_craft_contract_probe";
const PROBE_ROWS = 2;
const PROBE_ROW_ID = 1;

/** Far from UTC either way, so a driver that parses timestamps as local time shifts them visibly. */
const DISTANT_TIME_ZONE = "Pacific/Kiritimati";

const DIGITS = Array.from({ length: 10 }, (_, digit) => `SELECT ${digit} AS n`).join(" UNION ALL ");
/** 100,000 rows, more than any driver buffers in one fetch, in SQL every database accepts. */
const LARGE_RESULT_SQL =
  `SELECT a.n + 10 * b.n + 100 * c.n + 1000 * d.n + 10000 * e.n AS n FROM ` +
  ["a", "b", "c", "d", "e"].map((alias) => `(${DIGITS}) ${alias}`).join(" CROSS JOIN ");
const ROWS_READ_BEFORE_RETURN = 3;

const SLEEP_SECONDS = 30;
/** Long enough for the statement to reach the database before it is cancelled. */
const CANCEL_DELAY_MS = 500;
/** Well under `SLEEP_SECONDS`, so a cancel that did nothing fails the test instead of passing late. */
const CANCEL_DEADLINE_MS = 10_000;

async function collect(rows: AsyncIterable<Row>): Promise<Row[]> {
  const collected: Row[] = [];
  for await (const row of rows) collected.push(row);
  return collected;
}

const WRITABLE: ConnectOptions = { readOnly: false };
const READ_ONLY: ConnectOptions = { readOnly: true };

async function connect(plugin: DatasourcePlugin, config: unknown, options = WRITABLE): Promise<Session> {
  return plugin.connect(plugin.connectionSchema.parse(config), options);
}

async function withSession(
  plugin: DatasourcePlugin,
  fixture: ContractFixture,
  use: (session: Session) => Promise<void>,
  options = WRITABLE,
): Promise<void> {
  const session = await connect(plugin, fixture.config, options);
  try {
    await use(session);
  } finally {
    await session.close();
  }
}

async function rejectionCode(pending: Promise<unknown>): Promise<PluginErrorCode | "notAPluginError" | "resolved"> {
  try {
    await pending;
    return "resolved";
  } catch (error) {
    return isPluginError(error) ? error.code : "notAPluginError";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ObjectJsonSchema {
  readonly properties?: Record<string, unknown>;
  readonly required?: readonly string[];
}

/**
 * Where a manifest's connection form and the plugin's `connectionSchema` disagree (decision 019),
 * one sentence per problem; empty when they agree.
 */
export function connectionFormProblems(manifest: PluginManifest, connectionSchema: z.ZodType): string[] {
  const json = z.toJSONSchema(connectionSchema, { io: "input", unrepresentable: "any" }) as ObjectJsonSchema;
  const accepted = new Set(Object.keys(json.properties ?? {}));
  const fields = manifest.connection.fields;
  const keys = new Set(fields.map((field) => field.key));
  const problems: string[] = [];
  if (keys.size !== fields.length) problems.push("Two connection fields share a key.");
  for (const field of fields) {
    if (!accepted.has(field.key)) problems.push(`Field "${field.key}" is not accepted by connectionSchema.`);
    if (field.kind === "password" && field.secret !== true) {
      problems.push(`Password field "${field.key}" must be marked secret.`);
    }
    if (field.kind === "select" && field.options === undefined) {
      problems.push(`Select field "${field.key}" needs options.`);
    }
  }
  for (const key of json.required ?? []) {
    if (!keys.has(key)) problems.push(`connectionSchema requires "${key}", but no connection field fills it.`);
  }
  return problems;
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

    it("givenManifestFields_whenComparedWithConnectionSchema_thenAgree", () => {
      expect(fixture.manifest.id).toBe(plugin.id);
      expect(connectionFormProblems(fixture.manifest, plugin.connectionSchema)).toEqual([]);
    });

    it("givenSession_whenConnected_thenServerVersionNonEmpty", async () => {
      await withSession(plugin, fixture, (session) => {
        expect(session.serverVersion).toMatch(/\S/);
        return Promise.resolve();
      });
    });

    it.runIf(fixture.wrongPasswordConfig !== undefined)(
      "givenWrongPassword_whenConnecting_thenRejectsWithConnectionFailed",
      async () => {
        expect(await rejectionCode(connect(plugin, fixture.wrongPasswordConfig))).toBe("connectionFailed");
      },
    );

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

      it("givenInvalidSql_whenExecuted_thenRejectsWithStatementFailed", async () => {
        await withSession(plugin, fixture, async (session) => {
          expect(await rejectionCode(session.execute("SELEC 1"))).toBe("statementFailed");
        });
      });

      it.runIf(fixture.statements?.write !== undefined)(
        "givenReadOnlySession_whenInsert_thenStatementFailed",
        async () => {
          const write = fixture.statements?.write ?? "";
          await withSession(plugin, fixture, async (session) => {
            await session.execute(write);
          });
          await withSession(
            plugin,
            fixture,
            async (session) => {
              expect(await rejectionCode(session.execute(write))).toBe("statementFailed");
              expect(await collect((await session.execute("SELECT 1 AS one")).rows)).toEqual([[1]]);
            },
            READ_ONLY,
          );
        },
      );

      it("givenFailedStatement_whenNextStatementRun_thenSessionStillWorks", async () => {
        await withSession(plugin, fixture, async (session) => {
          await rejectionCode(session.execute("SELEC 1"));
          expect(await collect((await session.execute("SELECT 1 AS one")).rows)).toEqual([[1]]);
        });
      });

      it("givenTypeProbe_whenSelected_thenCellsMatchExpectedWireValues", async () => {
        await withSession(plugin, fixture, async (session) => {
          const result = await session.execute(`SELECT * FROM ${TYPE_PROBE_TABLE} ORDER BY id`);
          expect(result.columns.map((column) => column.name)).toEqual(TYPE_PROBE_COLUMNS);
          expect(await collect(result.rows)).toEqual(fixture.typeProbe.expected);
        });
      });

      describe("in a distant time zone", () => {
        let original: string | undefined;
        beforeEach(() => {
          original = process.env.TZ;
          process.env.TZ = DISTANT_TIME_ZONE;
        });
        afterEach(() => {
          if (original === undefined) delete process.env.TZ;
          else process.env.TZ = original;
        });

        it("givenTimestamp_whenSelected_thenTextIsUnshiftedByClientTimeZone", async () => {
          const momentColumn = TYPE_PROBE_COLUMNS.indexOf("moment");
          const dayColumn = TYPE_PROBE_COLUMNS.indexOf("day");
          const expected = fixture.typeProbe.expected.find((row) => row[0] === PROBE_ROW_ID);
          await withSession(plugin, fixture, async (session) => {
            const result = await session.execute(
              `SELECT day, moment FROM ${TYPE_PROBE_TABLE} WHERE id = ${PROBE_ROW_ID}`,
            );
            expect(await collect(result.rows)).toEqual([[expected?.[dayColumn], expected?.[momentColumn]]]);
          });
        });
      });

      it("givenLargeResult_whenIteratorReturnedEarly_thenCursorClosedAndSessionUsable", async () => {
        await withSession(plugin, fixture, async (session) => {
          const result = await session.execute(LARGE_RESULT_SQL);
          const iterator = result.rows[Symbol.asyncIterator]();
          for (let read = 0; read < ROWS_READ_BEFORE_RETURN; read += 1) {
            expect((await iterator.next()).done).toBe(false);
          }
          await iterator.return?.();
          expect(await collect((await session.execute("SELECT 1 AS one")).rows)).toEqual([[1]]);
        });
      });
    });

    describe.runIf(plugin.capabilities.includes("cancel"))("cancel", () => {
      function sleepSql(): string {
        const sleep = fixture.statements?.sleep;
        if (sleep === undefined) throw new Error("A plugin that declares cancel needs fixture.statements.sleep.");
        return sleep(SLEEP_SECONDS);
      }

      async function runAndCancel(session: Session): Promise<string> {
        const started = Date.now();
        const running = rejectionCode(session.execute(sleepSql()));
        await delay(CANCEL_DELAY_MS);
        await session.cancel?.();
        const code = await running;
        expect(Date.now() - started).toBeLessThan(CANCEL_DEADLINE_MS);
        return code;
      }

      it("givenSession_whenInspected_thenImplementsCancel", async () => {
        await withSession(plugin, fixture, (session) => {
          expect(typeof session.cancel).toBe("function");
          return Promise.resolve();
        });
      });

      it("givenIdleSession_whenCancelled_thenResolvesAndSessionWorks", async () => {
        await withSession(plugin, fixture, async (session) => {
          await session.cancel?.();
          expect(await collect((await session.execute("SELECT 1 AS one")).rows)).toEqual([[1]]);
        });
      });

      it("givenSleepingStatement_whenCancelled_thenExecuteRejectsWithCancelled", async () => {
        await withSession(plugin, fixture, async (session) => {
          expect(await runAndCancel(session)).toBe("cancelled");
        });
      });

      it("givenCancelledStatement_whenNextStatementRun_thenSessionStillWorks", async () => {
        await withSession(plugin, fixture, async (session) => {
          await runAndCancel(session);
          expect(await collect((await session.execute("SELECT 1 AS one")).rows)).toEqual([[1]]);
        });
      });
    });
  });
}
