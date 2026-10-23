import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BYTES_PREVIEW_LENGTH,
  CAPABILITIES,
  DefinitionNotFoundError,
  isPluginError,
  z,
  type BoundStatement,
  type CompletionCatalog,
  type ConnectOptions,
  type DatasourcePlugin,
  type ExecuteOptions,
  type ExplainedPlan,
  type GeneratedStatement,
  type PlanNode,
  type PluginErrorCode,
  type PluginManifest,
  type Introspector,
  type NamespaceCatalog,
  type Relation,
  type Row,
  type Session,
  type SqlLanguage,
  type Transactions,
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
    /**
     * Creates `TYPE_PROBE_COPY_TABLE` with `type_probe`'s columns and declared types; the literal
     * round trip creates and drops it. `CREATE TABLE … AS` will not do where it drops declared types.
     */
    readonly copyTable: string;
  };
  /** Scripts only this dialect splits, and the statements `language.split` must find in each. */
  readonly scripts?: readonly SplitCase[];
  /** Required when the plugin declares `schemaTree`. */
  readonly catalog?: {
    /** The namespace the fixture tables live in, which is also the connection's current one. */
    readonly path: readonly string[];
    /** An identifier that needs quoting, and what `qualifiedName(path, name)` must return for it. */
    readonly quoted: { readonly name: string; readonly qualified: string };
    /** `LINE_ITEMS_TABLE` as the dialect writes it in a statement, which completion must insert. */
    readonly lineItems: string;
    /** The name `orders`' check constraint carries, which its definition must show. */
    readonly ordersCheck: string;
    /** `customers`' table comment; null where the dialect has no comments. */
    readonly customersComment: string | null;
  };
}

export interface SplitCase {
  readonly text: string;
  readonly statements: readonly string[];
}

/** What every SQL dialect splits the same way (decision 023). */
const SHARED_SCRIPTS: readonly SplitCase[] = [
  { text: "SELECT 'a;b' AS s; SELECT 2 AS n", statements: ["SELECT 'a;b' AS s", "SELECT 2 AS n"] },
  { text: "SELECT 'it''s; here' AS s;\nSELECT 2 AS n;", statements: ["SELECT 'it''s; here' AS s", "SELECT 2 AS n"] },
  { text: 'SELECT 1 AS "a;b"; SELECT 2 AS n', statements: ['SELECT 1 AS "a;b"', "SELECT 2 AS n"] },
  {
    text: "SELECT 1 AS n -- not; here\n;\n/* nor; here */ SELECT 2 AS n /* inside; */ ;",
    statements: ["SELECT 1 AS n", "SELECT 2 AS n"],
  },
  { text: ";; ; -- only comments;\n/* ; */ ;", statements: [] },
];

/** Every SQL dialect calls these destructive, or not (decision 011). */
const DESTRUCTIVE_CASES: readonly (readonly [string, boolean])[] = [
  ["DELETE FROM orders", true],
  ["DELETE FROM orders WHERE id = 1", false],
  ["UPDATE orders SET total = 0", true],
  ["UPDATE orders SET total = (SELECT max(total) FROM orders o WHERE o.id = 1)", true],
  ["UPDATE orders SET total = total WHERE id = 1", false],
  ["DROP TABLE orders", true],
  ["TRUNCATE TABLE orders", true],
  ["SELECT * FROM orders", false],
  // Plain EXPLAIN only plans; ANALYZE runs the statement, so it is as destructive as it (decision 031).
  ["EXPLAIN DELETE FROM orders", false],
  ["EXPLAIN ANALYZE DELETE FROM orders", true],
  ["EXPLAIN ANALYZE DELETE FROM orders WHERE id = 1", false],
];

/** A row the transaction cases add to `orders` and always remove, so the fixture's counts hold. */
const TRANSACTION_ROW_ID = 9001;
const INSERT_TRANSACTION_ROW = `INSERT INTO orders (id, customer_id, total, placed_at) VALUES (${TRANSACTION_ROW_ID}, 1, 1.00, '2024-01-01 00:00:00')`;
const SELECT_TRANSACTION_ROW = `SELECT id FROM orders WHERE id = ${TRANSACTION_ROW_ID}`;
const DELETE_TRANSACTION_ROW = `DELETE FROM orders WHERE id = ${TRANSACTION_ROW_ID}`;

/** The table every fixture database carries, one column per value rule the contract pins. */
export const TYPE_PROBE_TABLE = "type_probe";
/** Where the literal round trip inserts `type_probe`'s rows; created and dropped by the suite. */
export const TYPE_PROBE_COPY_TABLE = "type_probe_copy";
const AWKWARD_IDENTIFIER = 'we"ird`name';

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

/** A fixture table whose name needs quoting in every dialect, for completion's quoting. */
export const LINE_ITEMS_TABLE = "Line Items";

/** The relations every fixture database carries, sorted by name as `describe` returns them. */
export const FIXTURE_RELATIONS = [
  { name: "customer_totals", kind: "view" },
  { name: "customers", kind: "table" },
  { name: "orders", kind: "table" },
  { name: "edit_probe", kind: "table" },
  { name: "no_key_probe", kind: "table" },
  { name: TYPE_PROBE_TABLE, kind: "table" },
  { name: LINE_ITEMS_TABLE, kind: "table" },
] as const;

/** The data editor's table (decision 026): a serial key and a default for every other column. */
export const EDIT_PROBE_TABLE = "edit_probe";
const EDIT_PROBE_SELECT = `SELECT id, label, qty, note FROM ${EDIT_PROBE_TABLE} ORDER BY id`;
const EDIT_PROBE_KEY_TYPE = "integer";
const EDIT_PROBE_TEXT_TYPE = "text";
const EDIT_PROBE_DEFAULT_QTY = 1;
const EDIT_PROBE_DEFAULT_LABEL = "new";
const MISSING_ROW_ID = -1;

const MISSING_NAMESPACE = "table_craft_no_such_namespace";
const MISSING_RELATION = "table_craft_no_such_relation";
const ORDERS_INDEX = "orders_placed_at_idx";
/** Created and dropped by the generated-DROP case. */
const DROP_PROBE_TABLE = "table_craft_drop_probe";

/** A join every fixture database plans with more than one step. */
const EXPLAIN_JOIN = "SELECT o.id, c.name FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.total > 10";
const EXPLAIN_DELETE_ALL = "DELETE FROM orders";
const EXPLAIN_UPDATE = "UPDATE orders SET total = total WHERE id = 1";
/** The `orders` rows every fixture database is seeded with. */
const ORDERS_ROWS = 3;
const ANALYSED_ORDER_ID = 1;
const ANALYSED_UPDATE = `UPDATE orders SET total = 0 WHERE id = ${ANALYSED_ORDER_ID}`;
const ANALYSED_TOTAL = `SELECT total FROM orders WHERE id = ${ANALYSED_ORDER_ID}`;

function planNodes(roots: readonly PlanNode[]): PlanNode[] {
  return roots.flatMap((node) => [node, ...planNodes(node.children)]);
}

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
/** Longer than `BYTES_PREVIEW_LENGTH` and within every fixture's `payload` column (MySQL's is `VARBINARY(64)`). */
const LONG_BYTES_LENGTH = 48;
const LONG_BYTES_HEX = "c3";
const HEX_DIGITS_PER_BYTE = 2;

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

function catalogPathOf(fixture: ContractFixture): readonly string[] {
  if (fixture.catalog === undefined) throw new Error("A plugin that declares schemaTree needs fixture.catalog.");
  return fixture.catalog.path;
}

const WRITABLE: ConnectOptions = { readOnly: false };
const READ_ONLY: ConnectOptions = { readOnly: true };

async function connect(plugin: DatasourcePlugin, config: unknown, options = WRITABLE): Promise<Session> {
  return plugin.connect(plugin.connectionSchema.parse(config), options);
}

/** A completion catalog straight over `introspector`, describing each namespace once. */
async function liveCompletionCatalog(introspector: Introspector): Promise<CompletionCatalog> {
  const namespaces = await introspector.namespaces();
  const described = new Map<string, Promise<NamespaceCatalog>>();
  const describe = (path: readonly string[]): Promise<NamespaceCatalog> => {
    const key = JSON.stringify(path);
    const known = described.get(key) ?? introspector.describe(path);
    described.set(key, known);
    return known;
  };
  return {
    current: namespaces.find((namespace) => namespace.current)?.path ?? null,
    namespaces: () => Promise.resolve(namespaces),
    relations: async (path) => (await describe(path)).relations,
    referencing: async (path, relation) => {
      const catalogs = await Promise.all([...described.values()]);
      return catalogs.flatMap((catalog) =>
        catalog.relations.flatMap((source) =>
          source.foreignKeys
            .filter(
              (key) => key.target.relation === relation && JSON.stringify(key.target.path) === JSON.stringify(path),
            )
            .map((foreignKey) => ({ path: catalog.path, relation: source.name, foreignKey })),
        ),
      );
    },
  };
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

    it("givenPlugin_whenInspected_thenHasLanguageExactlyWhenSqlDeclared", () => {
      expect(plugin.language !== undefined).toBe(plugin.capabilities.includes("sql"));
    });

    it("givenSession_whenInspected_thenHasTransactionsExactlyWhenDeclared", async () => {
      await withSession(plugin, fixture, (session) => {
        expect(session.transactions !== undefined).toBe(plugin.capabilities.includes("transactions"));
        expect(session.transactions?.mode ?? "auto").toBe("auto");
        expect(session.transactions?.open ?? false).toBe(false);
        return Promise.resolve();
      });
    });

    it("givenSession_whenInspected_thenHasIntrospectorExactlyWhenSchemaTreeDeclared", async () => {
      await withSession(plugin, fixture, (session) => {
        expect(session.introspector !== undefined).toBe(plugin.capabilities.includes("schemaTree"));
        return Promise.resolve();
      });
    });

    it("givenSession_whenInspected_thenHasDefinitionExactlyWhenDdlDeclared", async () => {
      const ddl = plugin.capabilities.includes("ddl");
      if (ddl) expect(plugin.capabilities).toContain("schemaTree");
      await withSession(plugin, fixture, (session) => {
        expect(session.introspector?.definition !== undefined).toBe(ddl);
        return Promise.resolve();
      });
    });

    it("givenPlugin_whenInspected_thenHasExplainableAndExplainExactlyWhenExplainDeclared", async () => {
      const explain = plugin.capabilities.includes("explain");
      if (explain) expect(plugin.capabilities).toContain("sql");
      if (plugin.capabilities.includes("explainAnalyze")) expect(plugin.capabilities).toContain("explain");
      expect(plugin.language?.explainable !== undefined).toBe(explain);
      await withSession(plugin, fixture, (session) => {
        expect(session.explain !== undefined).toBe(explain);
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

      describe("bound parameters", () => {
        function bound(sql: string, values: Readonly<Record<string, string | null>>): BoundStatement {
          if (plugin.language === undefined) throw new Error("A plugin that declares sql needs language.");
          return plugin.language.bind(sql, values);
        }

        it("givenParams_whenExecute_thenBoundAsValues", async () => {
          const statement = bound("SELECT name FROM customers WHERE id = :id AND name <> ':id'", { ":id": "2" });
          await withSession(plugin, fixture, async (session) => {
            expect(await collect((await session.execute(statement.sql, statement.params)).rows)).toEqual([
              ["Grace Hopper"],
            ]);
          });
        });

        it("givenNullParam_whenExecute_thenBindsNull", async () => {
          const statement = bound("SELECT name FROM customers WHERE id = :id OR :id IS NULL ORDER BY id", {
            ":id": null,
          });
          await withSession(plugin, fixture, async (session) => {
            expect(await collect((await session.execute(statement.sql, statement.params)).rows)).toEqual([
              ["Ada Lovelace"],
              ["Grace Hopper"],
            ]);
          });
        });

        it("givenQuoteInParam_whenExecute_thenLandsAsData", async () => {
          const value = "'; DROP TABLE customers; --";
          const statement = bound("SELECT name FROM customers WHERE name = :name OR id = :id", {
            ":name": value,
            ":id": "1",
          });
          await withSession(plugin, fixture, async (session) => {
            expect(await collect((await session.execute(statement.sql, statement.params)).rows)).toEqual([
              ["Ada Lovelace"],
            ]);
            const remaining = await session.execute("SELECT id FROM customers ORDER BY id");
            expect(await collect(remaining.rows)).toEqual([[1], [2]]);
          });
        });

        it("givenParamsThenPlainStatement_whenExecuted_thenBothRun", async () => {
          const statement = bound("SELECT name FROM customers WHERE id = :id", { ":id": "1" });
          await withSession(plugin, fixture, async (session) => {
            for (let run = 0; run < 2; run += 1) {
              expect(await collect((await session.execute(statement.sql, statement.params)).rows)).toEqual([
                ["Ada Lovelace"],
              ]);
            }
            expect(await collect((await session.execute("SELECT 1 AS one")).rows)).toEqual([[1]]);
          });
        });

        it("givenLanguage_whenFormatAndBind_thenRoundTripsThroughExecute", async () => {
          const language = plugin.language;
          if (language === undefined) throw new Error("A plugin that declares sql needs language.");
          const formatted = language.format("select name from customers where id = :id -- the second", {
            keywordCase: "upper",
            indentWidth: 2,
            linesBetweenStatements: 1,
          });
          expect(formatted).toContain("-- the second");
          expect(language.parameters(formatted).map((parameter) => parameter.name)).toEqual([":id"]);
          const statement = language.bind(formatted, { ":id": "2" });
          await withSession(plugin, fixture, async (session) => {
            expect(await collect((await session.execute(statement.sql, statement.params)).rows)).toEqual([
              ["Grace Hopper"],
            ]);
          });
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

    describe.runIf(plugin.capabilities.includes("sql"))("language", () => {
      function language(): SqlLanguage {
        if (plugin.language === undefined) throw new Error("A plugin that declares sql needs language.");
        return plugin.language;
      }

      function statementsOf(text: string): string[] {
        const spans = language().split(text);
        for (const span of spans) expect(text.slice(span.from, span.to)).toBe(span.sql);
        return spans.map((span) => span.sql);
      }

      it.each([...SHARED_SCRIPTS, ...(fixture.scripts ?? [])])(
        "givenScript_whenSplit_thenStatementsMatch: $text",
        ({ text, statements }) => {
          expect(statementsOf(text)).toEqual(statements);
        },
      );

      it("givenSplitScript_whenEachStatementExecuted_thenEachSucceeds", async () => {
        const statements = statementsOf("SELECT 'a;b' AS s;\n-- between\nSELECT 2 AS n;");
        await withSession(plugin, fixture, async (session) => {
          for (const sql of statements) await collect((await session.execute(sql)).rows);
        });
        expect(statements).toHaveLength(2);
      });

      it.each(DESTRUCTIVE_CASES)(
        "givenStatement_whenClassified_thenDestructiveMatches: %s → %s",
        (sql, destructive) => {
          expect(language().classify(sql).destructive !== null).toBe(destructive);
        },
      );

      it("givenAwkwardIdentifier_whenQuotedAndSelected_thenNameReadsBack", async () => {
        await withSession(plugin, fixture, async (session) => {
          const result = await session.execute(`SELECT 1 AS ${language().quoteIdentifier(AWKWARD_IDENTIFIER)}`);
          await collect(result.rows);
          expect(result.columns.map((column) => column.name)).toEqual([AWKWARD_IDENTIFIER]);
        });
      });

      it("givenTypeProbeRow_whenSqlInsertPerDialect_thenRoundTripsEqual", async () => {
        const dialect = language();
        const run = async (session: Session, sql: string): Promise<Row[]> => collect((await session.execute(sql)).rows);
        await withSession(plugin, fixture, async (session) => {
          const source = await session.execute(`SELECT * FROM ${TYPE_PROBE_TABLE} ORDER BY id`);
          const rows = await collect(source.rows);
          const names = source.columns.map((column) => dialect.quoteIdentifier(column.name)).join(", ");
          await run(session, `DROP TABLE IF EXISTS ${TYPE_PROBE_COPY_TABLE}`);
          await run(session, fixture.typeProbe.copyTable);
          try {
            for (const row of rows) {
              const values = row.map((value, index) => dialect.literal(value, source.columns[index]?.type ?? null));
              await run(
                session,
                `INSERT INTO ${dialect.quoteIdentifier(TYPE_PROBE_COPY_TABLE)} (${names}) VALUES (${values.join(", ")})`,
              );
            }
            expect(await run(session, `SELECT * FROM ${TYPE_PROBE_COPY_TABLE} ORDER BY id`)).toEqual(
              fixture.typeProbe.expected,
            );
          } finally {
            await run(session, `DROP TABLE IF EXISTS ${TYPE_PROBE_COPY_TABLE}`);
          }
        });
      });

      it("givenFullBytes_whenExecuting_thenBytesPreviewIsComplete", async () => {
        const dialect = language();
        const run = async (session: Session, sql: string, options?: ExecuteOptions): Promise<Row[]> =>
          collect((await session.execute(sql, [], options)).rows);
        const whole = LONG_BYTES_HEX.repeat(LONG_BYTES_LENGTH);
        await withSession(plugin, fixture, async (session) => {
          const probe = await session.execute(`SELECT id, payload FROM ${TYPE_PROBE_TABLE} ORDER BY id`);
          const payloadType = probe.columns[1]?.type ?? null;
          await collect(probe.rows);
          await run(session, `DROP TABLE IF EXISTS ${TYPE_PROBE_COPY_TABLE}`);
          await run(session, fixture.typeProbe.copyTable);
          try {
            const payload = dialect.literal({ kind: "bytes", preview: whole, length: LONG_BYTES_LENGTH }, payloadType);
            await run(
              session,
              `INSERT INTO ${dialect.quoteIdentifier(TYPE_PROBE_COPY_TABLE)} (id, payload) VALUES (${PROBE_ROW_ID}, ${payload})`,
            );
            const select = `SELECT payload FROM ${TYPE_PROBE_COPY_TABLE}`;
            expect(await run(session, select, { fullBytes: true })).toEqual([
              [{ kind: "bytes", preview: whole, length: LONG_BYTES_LENGTH }],
            ]);
            expect(await run(session, select)).toEqual([
              [
                {
                  kind: "bytes",
                  preview: whole.slice(0, BYTES_PREVIEW_LENGTH * HEX_DIGITS_PER_BYTE),
                  length: LONG_BYTES_LENGTH,
                },
              ],
            ]);
          } finally {
            await run(session, `DROP TABLE IF EXISTS ${TYPE_PROBE_COPY_TABLE}`);
          }
        });
      });

      it("givenDropTable_whenClassified_thenDdl", () => {
        expect(language().classify("DROP TABLE orders").kind).toBe("ddl");
        expect(language().classify("CREATE TABLE t (id INTEGER)").kind).toBe("ddl");
        expect(language().classify("SELECT 1").kind).toBe("read");
        expect(language().classify("INSERT INTO t VALUES (1)").kind).toBe("write");
        expect(language().classify("COMMIT").kind).toBe("transaction");
      });
    });

    describe.runIf(plugin.capabilities.includes("transactions"))("transactions", () => {
      function transactionsOf(session: Session): Transactions {
        if (session.transactions === undefined) throw new Error("A transactions session needs transactions.");
        return session.transactions;
      }

      async function rowsWithId(session: Session): Promise<number> {
        return (await collect((await session.execute(SELECT_TRANSACTION_ROW)).rows)).length;
      }

      async function removeRow(): Promise<void> {
        await withSession(plugin, fixture, async (session) => {
          await session.execute(DELETE_TRANSACTION_ROW);
        });
      }

      afterEach(removeRow);

      it("givenManualMode_whenInsertThenRollback_thenRowGoneAndNotOpen", async () => {
        await withSession(plugin, fixture, async (session) => {
          const transactions = transactionsOf(session);
          await transactions.setMode("manual");
          expect(transactions.open).toBe(false);
          await session.execute(INSERT_TRANSACTION_ROW);
          expect(transactions.open).toBe(true);
          expect(await rowsWithId(session)).toBe(1);
          await transactions.rollback();
          expect(transactions.open).toBe(false);
          expect(await rowsWithId(session)).toBe(0);
          expect(transactions.mode).toBe("manual");
        });
      });

      it("givenManualMode_whenInsertThenCommit_thenRowKept", async () => {
        await withSession(plugin, fixture, async (session) => {
          const transactions = transactionsOf(session);
          await transactions.setMode("manual");
          await session.execute(INSERT_TRANSACTION_ROW);
          await withSession(plugin, fixture, async (other) => {
            expect(await rowsWithId(other)).toBe(0);
          });
          await transactions.commit();
          expect(transactions.open).toBe(false);
        });
        await withSession(plugin, fixture, async (other) => {
          expect(await rowsWithId(other)).toBe(1);
        });
      });

      it("givenAutoMode_whenExplicitBegin_thenTransactionOpen", async () => {
        await withSession(plugin, fixture, async (session) => {
          const transactions = transactionsOf(session);
          await session.execute(INSERT_TRANSACTION_ROW);
          expect(transactions.open).toBe(false);
          await session.execute(DELETE_TRANSACTION_ROW);
          await session.execute("BEGIN");
          expect(transactions.open).toBe(true);
          await session.execute(INSERT_TRANSACTION_ROW);
          await session.execute("ROLLBACK");
          expect(transactions.open).toBe(false);
          expect(await rowsWithId(session)).toBe(0);
        });
      });

      it("givenOpenTransaction_whenSwitchedToAuto_thenRejectsWithStatementFailedAndStaysOpen", async () => {
        await withSession(plugin, fixture, async (session) => {
          const transactions = transactionsOf(session);
          await transactions.setMode("manual");
          await session.execute(INSERT_TRANSACTION_ROW);
          expect(await rejectionCode(transactions.setMode("auto"))).toBe("statementFailed");
          expect(transactions.open).toBe(true);
          await transactions.rollback();
          await transactions.setMode("auto");
          expect(transactions.mode).toBe("auto");
        });
      });

      it("givenNoOpenTransaction_whenCommitAndRollback_thenNoOps", async () => {
        await withSession(plugin, fixture, async (session) => {
          const transactions = transactionsOf(session);
          await transactions.commit();
          await transactions.rollback();
          expect(transactions.open).toBe(false);
          expect(await collect((await session.execute("SELECT 1 AS one")).rows)).toEqual([[1]]);
        });
      });
    });

    describe.runIf(plugin.capabilities.includes("sql") && plugin.capabilities.includes("transactions"))("edits", () => {
      it("givenEditProbe_whenEditsRoundTrip_thenRowsMatch", async () => {
        const dialect = plugin.language;
        if (dialect === undefined) throw new Error("A plugin that declares sql needs language.");
        const table = dialect.quoteIdentifier(EDIT_PROBE_TABLE);
        const name = (column: string): string => dialect.quoteIdentifier(column);
        const text = (value: string): string => dialect.literal(value, EDIT_PROBE_TEXT_TYPE);
        const key = (id: Row[number]): string => `${name("id")} = ${dialect.literal(id, EDIT_PROBE_KEY_TYPE)}`;
        await withSession(plugin, fixture, async (session) => {
          const transactions = session.transactions;
          if (transactions === undefined) throw new Error("A transactions session needs transactions.");
          const read = async (): Promise<Row[]> => collect((await session.execute(EDIT_PROBE_SELECT)).rows);
          const affected = async (sql: string): Promise<number | null> => {
            const result = await session.execute(sql);
            await collect(result.rows);
            return result.rowsAffected;
          };
          const qtyDefault =
            (await session.introspector?.describe(catalogPathOf(fixture)))?.relations
              .find((relation) => relation.name === EDIT_PROBE_TABLE)
              ?.columns.find((column) => column.name === "qty")?.default ?? String(EDIT_PROBE_DEFAULT_QTY);
          const before = await read();
          await transactions.setMode("manual");
          try {
            expect(await affected(`INSERT INTO ${table} (${name("label")}) VALUES (${text("round trip")})`)).toBe(1);
            expect(await affected(dialect.emptyInsert(table))).toBe(1);
            const inserted = (await read()).slice(before.length);
            expect(inserted.map((row) => row.slice(1))).toEqual([
              ["round trip", EDIT_PROBE_DEFAULT_QTY, null],
              [EDIT_PROBE_DEFAULT_LABEL, EDIT_PROBE_DEFAULT_QTY, null],
            ]);
            const [kept, dropped] = inserted;
            const update =
              `UPDATE ${table} SET ${name("label")} = ${text("it's changed")}, ${name("qty")} = ${text("7")}, ` +
              `${name("note")} = NULL WHERE ${key(kept?.[0] ?? null)}`;
            expect(await affected(update)).toBe(1);
            // Unchanged values must still count the matched row, or Submit would reject a no-op edit.
            expect(await affected(update)).toBe(1);
            const reset = `UPDATE ${table} SET ${name("qty")} = ${dialect.updateDefault(qtyDefault)} WHERE ${key(kept?.[0] ?? null)}`;
            expect(await affected(`UPDATE ${table} SET ${name("qty")} = 2 WHERE ${key(kept?.[0] ?? null)}`)).toBe(1);
            expect(await affected(reset)).toBe(1);
            expect(await affected(`DELETE FROM ${table} WHERE ${key(dropped?.[0] ?? null)}`)).toBe(1);
            expect((await read()).slice(before.length).map((row) => row.slice(1))).toEqual([
              ["it's changed", EDIT_PROBE_DEFAULT_QTY, null],
            ]);
            expect(
              await affected(`UPDATE ${table} SET ${name("label")} = ${text("x")} WHERE ${key(MISSING_ROW_ID)}`),
            ).toBe(0);
          } finally {
            await transactions.rollback();
            await transactions.setMode("auto");
          }
          expect(await read()).toEqual(before);
        });
      });
    });

    describe.runIf(plugin.capabilities.includes("schemaTree"))("schemaTree", () => {
      function catalogFixture(): NonNullable<ContractFixture["catalog"]> {
        if (fixture.catalog === undefined) {
          throw new Error("A plugin that declares schemaTree needs fixture.catalog.");
        }
        return fixture.catalog;
      }

      async function withIntrospector(use: (introspector: Introspector) => Promise<void>): Promise<void> {
        await withSession(plugin, fixture, async (session) => {
          const introspector = session.introspector;
          if (introspector === undefined) throw new Error("A schemaTree session needs an introspector.");
          await use(introspector);
        });
      }

      async function describeFixture(): Promise<NamespaceCatalog> {
        let described: NamespaceCatalog | undefined;
        await withIntrospector(async (introspector) => {
          described = await introspector.describe(catalogFixture().path);
        });
        if (described === undefined) throw new Error("describe resolved nothing.");
        return described;
      }

      function relation(catalog: NamespaceCatalog, name: string): Relation {
        const found = catalog.relations.find((candidate) => candidate.name === name);
        if (found === undefined) throw new Error(`The fixture namespace has no relation ${name}.`);
        return found;
      }

      it("givenSchemaTreePlugin_whenNamespacesListed_thenCurrentNamespaceIsMarked", async () => {
        await withIntrospector(async (introspector) => {
          const namespaces = await introspector.namespaces();
          const current = namespaces.filter((namespace) => namespace.current);
          expect(current.map((namespace) => namespace.path)).toEqual([catalogFixture().path]);
          expect(current[0]?.system).toBe(false);
          expect(current[0]?.name).toBe(catalogFixture().path.at(-1));
        });
      });

      it("givenFixture_whenDescribed_thenCustomersOrdersTypeProbeAndCustomerTotalsArePresent", async () => {
        const catalog = await describeFixture();
        expect(catalog.path).toEqual(catalogFixture().path);
        const names = catalog.relations.map((candidate) => candidate.name);
        expect(names).toEqual([...names].sort());
        expect(catalog.relations.map(({ name, kind }) => ({ name, kind }))).toEqual(
          expect.arrayContaining(FIXTURE_RELATIONS.map((expected) => ({ ...expected }))),
        );
        const probe = relation(catalog, TYPE_PROBE_TABLE);
        expect(probe.columns.map((column) => column.name)).toEqual(TYPE_PROBE_COLUMNS);
        expect(probe.columns.map((column) => column.position)).toEqual(TYPE_PROBE_COLUMNS.map((_, index) => index + 1));
        for (const column of probe.columns) expect(column.type).toMatch(/\S/);
      });

      it("givenOrders_whenDescribed_thenForeignKeyTargetsCustomersId", async () => {
        const orders = relation(await describeFixture(), "orders");
        expect(orders.foreignKeys).toHaveLength(1);
        expect(orders.foreignKeys[0]).toMatchObject({
          columns: ["customer_id"],
          target: { path: catalogFixture().path, relation: "customers", columns: ["id"] },
        });
        expect(orders.foreignKeys[0]?.onDelete).toMatch(/\S/);
        const customerId = orders.columns.find((column) => column.name === "customer_id");
        expect(customerId?.nullable).toBe(false);
      });

      it("givenOrders_whenDescribed_thenIndexOrdersPlacedAtIdxIsListed", async () => {
        const orders = relation(await describeFixture(), "orders");
        expect(orders.indexes).toContainEqual({
          name: ORDERS_INDEX,
          columns: ["placed_at"],
          unique: false,
          primary: false,
        });
      });

      it("givenCustomers_whenDescribed_thenIdIsPrimaryKeyAndEmailIsUnique", async () => {
        const customers = relation(await describeFixture(), "customers");
        expect(customers.comment).toBe(catalogFixture().customersComment);
        expect(customers.primaryKey?.columns).toEqual(["id"]);
        expect(customers.uniqueKeys.map((key) => key.columns)).toEqual([["email"]]);
        expect(customers.columns.find((column) => column.name === "email")?.nullable).toBe(false);
      });

      it("givenUnknownNamespace_whenDescribed_thenRejectsWithIntrospectionFailed", async () => {
        const missing = [...catalogFixture().path.slice(0, -1), MISSING_NAMESPACE];
        await withIntrospector(async (introspector) => {
          expect(await rejectionCode(introspector.describe(missing))).toBe("introspectionFailed");
        });
      });

      it("givenIdentifierNeedingQuotes_whenQualified_thenPluginQuotesIt", async () => {
        const { path, quoted } = catalogFixture();
        await withIntrospector((introspector) => {
          expect(introspector.qualifiedName(path, quoted.name)).toBe(quoted.qualified);
          return Promise.resolve();
        });
      });

      it("givenIntrospection_whenStatementRunAfter_thenSessionStillWorks", async () => {
        await withSession(plugin, fixture, async (session) => {
          await session.introspector?.describe(catalogFixture().path);
          expect(await collect((await session.execute("SELECT 1 AS one")).rows)).toEqual([[1]]);
        });
      });
    });

    describe.runIf(plugin.capabilities.includes("sql") && plugin.capabilities.includes("schemaTree"))(
      "completion",
      () => {
        function completionFixture() {
          const catalog = fixture.catalog;
          const language = plugin.language;
          if (catalog === undefined || language === undefined) {
            throw new Error("A plugin that declares sql and schemaTree needs a language and fixture.catalog.");
          }
          return { catalog, language };
        }

        /** The completer against the live database, read the way the engine's cache reads it. */
        async function withCompletion(
          use: (language: SqlLanguage, catalog: CompletionCatalog) => Promise<void>,
        ): Promise<void> {
          const { language } = completionFixture();
          await withSession(plugin, fixture, async (session) => {
            const introspector = session.introspector;
            if (introspector === undefined) throw new Error("A schemaTree session needs an introspector.");
            await use(language, await liveCompletionCatalog(introspector));
          });
        }

        function at(text: string, marker: string): { text: string; offset: number } {
          return { text: text.replace(marker, ""), offset: text.indexOf(marker) };
        }

        it("givenFromClause_whenCompleting_thenOffersFixtureTablesAndViews", async () => {
          await withCompletion(async (language, catalog) => {
            const result = await language.complete(at("SELECT * FROM |", "|"), catalog);
            const offered = result.items.map(({ label, kind }) => ({ label, kind }));
            expect(offered).toEqual(
              expect.arrayContaining([
                { label: "orders", kind: "table" },
                { label: "customers", kind: "table" },
                { label: "customer_totals", kind: "view" },
              ]),
            );
          });
        });

        it("givenAliasDot_whenCompleting_thenOffersAliasedColumnsWithTypes", async () => {
          await withCompletion(async (language, catalog) => {
            const result = await language.complete(at("SELECT o.| FROM orders o", "|"), catalog);
            const columns = result.items.filter((item) => item.kind === "column");
            expect(columns.map((item) => item.label)).toEqual(["id", "customer_id", "total", "placed_at"]);
            for (const column of columns) expect(column.detail).toMatch(/\S/);
          });
        });

        it("givenJoinAfterOrders_whenCompleting_thenCustomersJoinFirstWithOnClause", async () => {
          await withCompletion(async (language, catalog) => {
            const result = await language.complete(at("SELECT * FROM orders o JOIN |", "|"), catalog);
            const first = [...result.items].sort((left, right) => right.boost - left.boost)[0];
            expect(first).toMatchObject({ kind: "join", apply: "customers c ON c.id = o.customer_id" });
          });
        });

        it("givenNameNeedingQuotes_whenCompleting_thenApplyIsQuotedByDialect", async () => {
          const { catalog: expected } = completionFixture();
          await withCompletion(async (language, catalog) => {
            const result = await language.complete(at("SELECT * FROM Li|", "|"), catalog);
            const item = result.items.find((candidate) => candidate.label === LINE_ITEMS_TABLE);
            expect(item?.apply).toBe(expected.lineItems);
          });
        });

        it("givenAliasReference_whenResolving_thenReturnsDeclarationSpan", async () => {
          await withCompletion(async (language, catalog) => {
            const text = "SELECT o.id FROM orders o";
            const declaration = await language.resolve({ text, offset: text.indexOf("o.id") }, catalog);
            const from = text.indexOf("orders o");
            expect(declaration).toEqual({ kind: "alias", from, to: from + "orders o".length });
          });
        });

        it("givenRelationReference_whenResolving_thenReturnsCurrentPathAndRelation", async () => {
          const { catalog: expected } = completionFixture();
          await withCompletion(async (language, catalog) => {
            const text = "SELECT * FROM customers";
            const declaration = await language.resolve({ text, offset: text.indexOf("customers") + 2 }, catalog);
            expect(declaration).toEqual({ kind: "relation", path: expected.path, relation: "customers" });
          });
        });
      },
    );

    describe.runIf(plugin.capabilities.includes("ddl"))("ddl", () => {
      function catalogFixture(): NonNullable<ContractFixture["catalog"]> {
        if (fixture.catalog === undefined) throw new Error("A plugin that declares ddl needs fixture.catalog.");
        return fixture.catalog;
      }

      async function definitionOf(name: string, path = catalogFixture().path): Promise<string> {
        let definition = "";
        await withSession(plugin, fixture, async (session) => {
          const read = session.introspector?.definition?.bind(session.introspector);
          if (read === undefined) throw new Error("A ddl session needs introspector.definition.");
          definition = await read(path, name);
        });
        return definition;
      }

      it("givenTable_whenReadingDefinition_thenIncludesColumnsKeysAndCheck", async () => {
        const definition = await definitionOf("orders");
        for (const column of ["id", "customer_id", "total", "placed_at"]) expect(definition).toContain(column);
        expect(definition).toMatch(/PRIMARY KEY/i);
        expect(definition).toContain(catalogFixture().ordersCheck);
        expect(definition).toMatch(/CHECK/i);
        expect(definition).toContain(ORDERS_INDEX);
        expect(definition.trimEnd().endsWith(";")).toBe(true);
      });

      it("givenTableWithForeignKey_whenReadingDefinition_thenNamesTarget", async () => {
        expect(await definitionOf("orders")).toMatch(/REFERENCES\s+\S*customers\S*\s*\(\S*id\S*\)/i);
      });

      it("givenView_whenReadingDefinition_thenIncludesItsQuery", async () => {
        const definition = await definitionOf("customer_totals");
        expect(definition).toMatch(/CREATE\b[\s\S]*\bVIEW\b/i);
        expect(definition).toMatch(/coalesce/i);
        expect(definition).toMatch(/customers/);
      });

      it("givenCustomers_whenReadingDefinition_thenIncludesTheTableComment", async () => {
        const comment = catalogFixture().customersComment;
        const definition = await definitionOf("customers");
        if (comment !== null) expect(definition).toContain(comment);
        expect(definition).toContain("email");
      });

      it("givenUnknownRelation_whenReadingDefinition_thenDefinitionNotFound", async () => {
        await withSession(plugin, fixture, async (session) => {
          const pending = session.introspector?.definition?.(catalogFixture().path, MISSING_RELATION);
          const failure: unknown = await pending?.catch((error: unknown) => error);
          expect(isPluginError(failure) && failure.code).toBe("definitionNotFound");
          expect(failure instanceof Error && failure.message).toContain(MISSING_RELATION);
        });
      });

      it("givenDefinitionNotFoundError_whenConstructed_thenNamesPathAndRelation", () => {
        const error = new DefinitionNotFoundError(catalogFixture().path, MISSING_RELATION);
        expect(isPluginError(error)).toBe(true);
        expect(error.message).toContain(catalogFixture().path.join("."));
      });
    });

    describe.runIf(plugin.capabilities.includes("sql") && plugin.capabilities.includes("schemaTree"))(
      "generate",
      () => {
        async function withGenerator(
          use: (session: Session, generated: (statement: GeneratedStatement, name: string) => string) => Promise<void>,
        ): Promise<void> {
          const language = plugin.language;
          if (language === undefined || fixture.catalog === undefined) {
            throw new Error("A plugin that declares sql and schemaTree needs a language and fixture.catalog.");
          }
          const path = fixture.catalog.path;
          await withSession(plugin, fixture, async (session) => {
            const introspector = session.introspector;
            if (introspector === undefined) throw new Error("A schemaTree session needs an introspector.");
            const catalog = await introspector.describe(path);
            await use(session, (statement, name) => {
              const relation = catalog.relations.find((candidate) => candidate.name === name);
              if (relation === undefined) throw new Error(`The fixture namespace has no relation ${name}.`);
              const sql = language.generate(statement, relation, introspector.qualifiedName(path, name));
              const spans = language.split(sql);
              expect(spans).toHaveLength(1);
              return spans[0]?.sql ?? "";
            });
          });
        }

        it("givenGeneratedSelect_whenExecuted_thenReturnsTheTablesColumns", async () => {
          await withGenerator(async (session, generated) => {
            const result = await session.execute(generated("select", LINE_ITEMS_TABLE));
            await collect(result.rows);
            expect(result.columns.map((column) => column.name)).toEqual(["id", "sku"]);
          });
        });

        it("givenGeneratedUpdate_whenExecuted_thenAffectsNoRows", async () => {
          await withGenerator(async (session, generated) => {
            const sql = generated("update", "orders");
            const result = await session.execute(sql);
            await collect(result.rows);
            expect(result.rowsAffected).toBe(0);
          });
        });

        it.runIf(plugin.capabilities.includes("transactions"))(
          "givenGeneratedInsert_whenExecutedInTransaction_thenInsertsOneRow",
          async () => {
            await withGenerator(async (session, generated) => {
              const transactions = session.transactions;
              if (transactions === undefined) throw new Error("A transactions session needs transactions.");
              await transactions.setMode("manual");
              try {
                const result = await session.execute(generated("insert", EDIT_PROBE_TABLE));
                await collect(result.rows);
                expect(result.rowsAffected).toBe(1);
              } finally {
                await transactions.rollback();
                await transactions.setMode("auto");
              }
            });
          },
        );

        it("givenGeneratedDrop_whenExecuted_thenRelationGone", async () => {
          await withSession(plugin, fixture, async (session) => {
            await collect((await session.execute(`CREATE TABLE ${DROP_PROBE_TABLE} (id INTEGER)`)).rows);
          });
          try {
            await withGenerator(async (session, generated) => {
              await collect((await session.execute(generated("drop", DROP_PROBE_TABLE))).rows);
              expect(await rejectionCode(session.execute(`SELECT * FROM ${DROP_PROBE_TABLE}`))).toBe("statementFailed");
            });
          } finally {
            await withSession(plugin, fixture, async (session) => {
              await collect((await session.execute(`DROP TABLE IF EXISTS ${DROP_PROBE_TABLE}`)).rows);
            });
          }
        });
      },
    );

    describe.runIf(plugin.capabilities.includes("explain"))("explain", () => {
      function explainable(): NonNullable<SqlLanguage["explainable"]> {
        const language = plugin.language;
        if (language?.explainable === undefined) {
          throw new Error("A plugin that declares explain needs language.explainable.");
        }
        return (sql, options) => language.explainable?.(sql, options) ?? { ok: false, reason: "" };
      }

      async function explained(session: Session, sql: string, analyze: boolean): Promise<ExplainedPlan> {
        if (session.explain === undefined) throw new Error("An explain session needs explain.");
        return session.explain(sql, { analyze });
      }

      async function ordersRows(session: Session): Promise<number> {
        return (await collect((await session.execute("SELECT id FROM orders")).rows)).length;
      }

      it("givenSelect_whenExplained_thenTreeWithAnOperation", async () => {
        await withSession(plugin, fixture, async (session) => {
          const plan = await explained(session, EXPLAIN_JOIN, false);
          expect(plan.analyzed).toBe(false);
          expect(plan.statement).toMatch(/^EXPLAIN\b/i);
          expect(plan.statement).toContain(EXPLAIN_JOIN);
          expect(plan.raw).toMatch(/\S/);
          const nodes = planNodes(plan.roots);
          expect(nodes.length).toBeGreaterThan(1);
          for (const node of nodes) {
            expect(node.operation).toMatch(/\S/);
            expect([node.actualRows, node.actualTimeMs, node.loops]).toEqual([null, null, null]);
          }
          expect(await ordersRows(session)).toBe(ORDERS_ROWS);
        });
      });

      it("givenDeleteWithoutWhere_whenExplained_thenNothingRuns", async () => {
        await withSession(plugin, fixture, async (session) => {
          const plan = await explained(session, EXPLAIN_DELETE_ALL, false);
          expect(plan.roots.length).toBeGreaterThan(0);
          expect(await ordersRows(session)).toBe(ORDERS_ROWS);
        });
      });

      it("givenDdl_whenExplainable_thenRefusedWithReason", async () => {
        const verdict = explainable()("CREATE TABLE t (id INTEGER)", { analyze: false });
        expect(verdict.ok).toBe(false);
        expect(verdict.ok ? "" : verdict.reason).toMatch(/\S/);
        await withSession(plugin, fixture, async (session) => {
          expect(await rejectionCode(explained(session, "CREATE TABLE t (id INTEGER)", false))).toBe(
            "explainUnsupported",
          );
          expect(await ordersRows(session)).toBe(ORDERS_ROWS);
        });
      });

      it("givenTwoStatements_whenExplainable_thenRefused", () => {
        expect(explainable()("SELECT 1; SELECT 2", { analyze: false }).ok).toBe(false);
        expect(explainable()("  -- nothing\n", { analyze: false }).ok).toBe(false);
      });

      it("givenExplainStatement_whenExplainable_thenRefused", () => {
        expect(explainable()(`EXPLAIN ${EXPLAIN_JOIN}`, { analyze: false }).ok).toBe(false);
      });

      it("givenReadAndWrite_whenExplainable_thenWritesOnlyForTheWrite", () => {
        expect(explainable()(EXPLAIN_JOIN, { analyze: false })).toEqual({ ok: true, writes: false });
        expect(explainable()(EXPLAIN_UPDATE, { analyze: false })).toEqual({ ok: true, writes: true });
      });

      it.runIf(!plugin.capabilities.includes("explainAnalyze"))(
        "givenNoExplainAnalyze_whenAnalyseExplainable_thenRefused",
        () => {
          expect(explainable()(EXPLAIN_JOIN, { analyze: true }).ok).toBe(false);
        },
      );
    });

    describe.runIf(plugin.capabilities.includes("explainAnalyze"))("explainAnalyze", () => {
      async function analysed(session: Session, sql: string): Promise<ExplainedPlan> {
        if (session.explain === undefined) throw new Error("An explain session needs explain.");
        return session.explain(sql, { analyze: true });
      }

      it("givenSelect_whenAnalysed_thenActualRowsPresent", async () => {
        await withSession(plugin, fixture, async (session) => {
          const plan = await analysed(session, EXPLAIN_JOIN);
          expect(plan.analyzed).toBe(true);
          expect(planNodes(plan.roots).some((node) => node.actualRows !== null && node.loops !== null)).toBe(true);
        });
      });

      it.runIf(
        plugin.capabilities.includes("transactions") &&
          plugin.language?.explainable?.(ANALYSED_UPDATE, { analyze: true }).ok === true,
      )("givenUpdateInManualTransaction_whenAnalysed_thenRolledBackLeavesRows", async () => {
        await withSession(plugin, fixture, async (session) => {
          const transactions = session.transactions;
          if (transactions === undefined) throw new Error("A transactions session needs transactions.");
          const total = async (): Promise<Row[]> => collect((await session.execute(ANALYSED_TOTAL)).rows);
          const before = await total();
          await transactions.setMode("manual");
          try {
            const plan = await analysed(session, ANALYSED_UPDATE);
            expect(plan.analyzed).toBe(true);
            expect(transactions.open).toBe(true);
            expect(await total()).not.toEqual(before);
          } finally {
            await transactions.rollback();
            await transactions.setMode("auto");
          }
          expect(await total()).toEqual(before);
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
