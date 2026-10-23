import {
  CoreError,
  EditRejectedError,
  READ_ONLY_REASONS,
  editableIdentity,
  generateEdits,
  matchCondition,
  submitEdits,
  tableCount,
  tableSelect,
  type EditColumn,
  type RowEdit,
} from "@table-craft/core";
import {
  PluginError,
  type ExecuteResult,
  type Relation,
  type Row,
  type Session,
  type SqlLanguage,
  type TransactionMode,
} from "@table-craft/plugin-api";
import {
  defaultKeyword,
  defaultValuesInsert,
  quoteIdentifierWith,
  sqlCompleter,
  sqlFormatter,
  sqlGenerator,
  sqlLiteral,
  sqlParameters,
  sqlSplitter,
  classifyTokens,
} from "@table-craft/plugin-api/sql";
import { describe, expect, it } from "vitest";

const LANGUAGE: SqlLanguage = {
  ...sqlFormatter({ dialect: "sqlite", lexer: {}, parameters: [] }),
  ...sqlParameters({ dialect: {}, styles: [], native: "positional" }),
  split: sqlSplitter({}),
  classify: (sql) => classifyTokens(sql, {}),
  quoteIdentifier: quoteIdentifierWith('"'),
  literal: (value) => sqlLiteral(value, { backslashEscapes: false, bytes: (hex) => `X'${hex}'` }),
  emptyInsert: defaultValuesInsert,
  updateDefault: defaultKeyword,
  ...sqlCompleter({
    dialect: {},
    identifierFolding: "none",
    plainIdentifier: /^[A-Za-z_][A-Za-z0-9_]*$/,
    quoteIdentifier: quoteIdentifierWith('"'),
    keywords: [],
    functions: [],
  }),
  ...sqlGenerator({
    quoteIdentifier: quoteIdentifierWith('"'),
    updateDefault: defaultKeyword,
    plainIdentifier: /^[A-Za-z_][A-Za-z0-9_]*$/,
    keywords: [],
  }),
};

const TABLE = '"public"."orders"';
const COLUMNS: readonly EditColumn[] = [
  { name: "id", type: "integer", default: null },
  { name: "total", type: "numeric(12,2)", default: null },
  { name: "note", type: "text", default: "'none'::text" },
];
const ROWS: readonly Row[] = [
  [1, "19.99", null],
  [2, "5.00", "late"],
  [3, "120.50", null],
];

function generate(edits: readonly RowEdit[], rows: readonly Row[] = ROWS): string[] {
  return generateEdits({
    table: TABLE,
    columns: COLUMNS,
    identity: [0],
    rows: (row) => rows[row],
    edits,
    language: LANGUAGE,
  });
}

function relation(overrides: Partial<Relation>): Relation {
  return {
    name: "orders",
    kind: "table",
    comment: null,
    columns: [
      { name: "id", position: 1, type: "integer", nullable: false, default: null, comment: null, autoIncrement: true },
      { name: "code", position: 2, type: "text", nullable: true, default: null, comment: null, autoIncrement: false },
      { name: "slug", position: 3, type: "text", nullable: false, default: null, comment: null, autoIncrement: false },
    ],
    primaryKey: null,
    uniqueKeys: [],
    foreignKeys: [],
    indexes: [],
    ...overrides,
  };
}

const ALL = ["sql", "transactions"] as const;

describe("editableIdentity", () => {
  it("givenTableWithPrimaryKey_whenIdentityResolved_thenPrimaryKeyColumns", () => {
    const table = relation({ primaryKey: { name: "orders_pk", columns: ["id"] } });
    expect(editableIdentity(table, false, ALL)).toEqual({ identity: ["id"] });
  });

  it("givenTableWithOnlyNullableUnique_whenIdentityResolved_thenReadOnlyWithReason", () => {
    const table = relation({ uniqueKeys: [{ name: "orders_code_key", columns: ["code"] }] });
    expect(editableIdentity(table, false, ALL)).toEqual({ readOnly: READ_ONLY_REASONS.noKey });
  });

  it("givenNullableThenNonNullUnique_whenIdentityResolved_thenFirstNonNullUnique", () => {
    const table = relation({
      uniqueKeys: [
        { name: "orders_code_key", columns: ["code"] },
        { name: "orders_slug_key", columns: ["slug"] },
      ],
    });
    expect(editableIdentity(table, false, ALL)).toEqual({ identity: ["slug"] });
  });

  it("givenView_whenIdentityResolved_thenReadOnly", () => {
    expect(editableIdentity(relation({ kind: "view" }), false, ALL)).toEqual({ readOnly: READ_ONLY_REASONS.view });
    expect(editableIdentity(relation({ kind: "materializedView" }), false, ALL)).toEqual({
      readOnly: READ_ONLY_REASONS.materializedView,
    });
  });

  it("givenReadOnlyDatasource_whenIdentityResolved_thenReadOnly", () => {
    const table = relation({ primaryKey: { name: "orders_pk", columns: ["id"] } });
    expect(editableIdentity(table, true, ALL)).toEqual({ readOnly: READ_ONLY_REASONS.datasource });
  });

  it("givenPluginWithoutTransactions_whenIdentityResolved_thenReadOnly", () => {
    const table = relation({ primaryKey: { name: "orders_pk", columns: ["id"] } });
    expect(editableIdentity(table, false, ["sql"])).toEqual({ readOnly: READ_ONLY_REASONS.transactions });
  });
});

describe("generateEdits", () => {
  it("givenUpdateOfTwoCells_whenGenerated_thenOneUpdateKeyedByPrimaryKey", () => {
    const edits: RowEdit[] = [
      {
        kind: "update",
        row: 1,
        values: [
          { column: 1, value: { kind: "text", text: "51.00" } },
          { column: 2, value: { kind: "text", text: "it's" } },
        ],
      },
    ];
    expect(generate(edits)).toEqual([`UPDATE ${TABLE} SET "total" = '51.00', "note" = 'it''s' WHERE "id" = 2`]);
  });

  it("givenInsertWithDefaults_whenGenerated_thenDefaultColumnsOmitted", () => {
    const edits: RowEdit[] = [
      { kind: "insert", values: [{ kind: "default" }, { kind: "text", text: "9.50" }, { kind: "default" }] },
    ];
    expect(generate(edits)).toEqual([`INSERT INTO ${TABLE} ("total") VALUES ('9.50')`]);
  });

  it("givenInsertWithAllDefaults_whenGenerated_thenEmptyInsertFromPlugin", () => {
    const edits: RowEdit[] = [
      { kind: "insert", values: [{ kind: "default" }, { kind: "default" }, { kind: "default" }] },
    ];
    expect(generate(edits)).toEqual([`INSERT INTO ${TABLE} DEFAULT VALUES`]);
  });

  it("givenNullInput_whenGenerated_thenNullLiteral", () => {
    const edits: RowEdit[] = [{ kind: "update", row: 0, values: [{ column: 2, value: { kind: "null" } }] }];
    expect(generate(edits)).toEqual([`UPDATE ${TABLE} SET "note" = NULL WHERE "id" = 1`]);
  });

  it("givenDefaultInputInUpdate_whenGenerated_thenPluginsUpdateDefault", () => {
    const edits: RowEdit[] = [{ kind: "update", row: 0, values: [{ column: 2, value: { kind: "default" } }] }];
    expect(generate(edits)).toEqual([`UPDATE ${TABLE} SET "note" = DEFAULT WHERE "id" = 1`]);
  });

  it("givenDeletesUpdatesInserts_whenGenerated_thenDeletesFirstInsertsLast", () => {
    const edits: RowEdit[] = [
      { kind: "insert", values: [{ kind: "default" }, { kind: "text", text: "1" }, { kind: "null" }] },
      { kind: "update", row: 0, values: [{ column: 1, value: { kind: "text", text: "2" } }] },
      { kind: "delete", row: 2 },
    ];
    expect(generate(edits)).toEqual([
      `DELETE FROM ${TABLE} WHERE "id" = 3`,
      `UPDATE ${TABLE} SET "total" = '2' WHERE "id" = 1`,
      `INSERT INTO ${TABLE} ("total", "note") VALUES ('1', NULL)`,
    ]);
  });

  it("givenNullKeyValue_whenGenerated_thenInvalidRequest", () => {
    const rows: Row[] = [[null, "1.00", null]];
    expect(() => generate([{ kind: "delete", row: 0 }], rows)).toThrow(CoreError);
  });

  it("givenBytesKeyValue_whenGenerated_thenInvalidRequest", () => {
    const rows: Row[] = [[{ kind: "bytes", preview: "dead", length: 2 }, "1.00", null]];
    expect(() => generate([{ kind: "delete", row: 0 }], rows)).toThrow(/bytes/);
  });

  it("givenRowUpdatedAndDeleted_whenGenerated_thenInvalidRequest", () => {
    const edits: RowEdit[] = [
      { kind: "update", row: 0, values: [{ column: 1, value: { kind: "null" } }] },
      { kind: "delete", row: 0 },
    ];
    expect(() => generate(edits)).toThrow(/both/);
  });

  it("givenRowNeverHeld_whenGenerated_thenInvalidRequest", () => {
    expect(() => generate([{ kind: "delete", row: 99 }])).toThrow(/no longer held/);
  });
});

interface FakeSession extends Session {
  readonly log: string[];
}

/** A session that answers each statement with the next outcome: rows affected, or an error to throw. */
function fake(outcomes: readonly (number | null | Error)[]): FakeSession {
  const log: string[] = [];
  let mode: TransactionMode = "auto";
  let open = false;
  let next = 0;
  return {
    log,
    serverVersion: null,
    transactions: {
      setMode: (to) => {
        log.push(`mode ${to}`);
        mode = to;
        return Promise.resolve();
      },
      commit: () => {
        log.push("commit");
        open = false;
        return Promise.resolve();
      },
      rollback: () => {
        log.push("rollback");
        open = false;
        return Promise.resolve();
      },
      get mode() {
        return mode;
      },
      get open() {
        return open;
      },
    },
    execute: (sql) => {
      log.push(sql);
      if (mode === "manual") open = true;
      const outcome = outcomes[next];
      next += 1;
      if (outcome instanceof Error) return Promise.reject(outcome);
      const result: ExecuteResult = { columns: [], rows: (async function* () {})(), rowsAffected: outcome ?? null };
      return Promise.resolve(result);
    },
    close: () => Promise.resolve(),
  };
}

describe("table queries", () => {
  it("givenWhereAndOrderBars_whenQueryBuilt_thenVerbatimClauses", () => {
    expect(tableSelect(TABLE, { where: "  status = 'paid' ;; ", orderBy: "id DESC, total" })).toBe(
      `SELECT * FROM ${TABLE} WHERE status = 'paid' ORDER BY id DESC, total`,
    );
    expect(tableSelect(TABLE, { where: "", orderBy: " " })).toBe(`SELECT * FROM ${TABLE}`);
  });

  it("givenWhereBar_whenCountBuilt_thenCountWithSameCondition", () => {
    expect(tableCount(TABLE, "total > 3")).toBe(`SELECT COUNT(*) FROM ${TABLE} WHERE total > 3`);
  });

  it("givenOneValue_whenConditionBuilt_thenEquality", () => {
    expect(matchCondition(LANGUAGE, [{ name: "status", type: "text" }], [["paid"]])).toBe(`"status" = 'paid'`);
  });

  it("givenSeveralValuesAndNull_whenConditionBuilt_thenInListOrIsNull", () => {
    const condition = matchCondition(LANGUAGE, [{ name: "n", type: "int" }], [[1], [2], [1], [null]]);

    expect(condition).toBe(`("n" IN (1, 2) OR "n" IS NULL)`);
  });

  it("givenOnlyNull_whenConditionBuilt_thenIsNull", () => {
    expect(matchCondition(LANGUAGE, [{ name: "n", type: "int" }], [[null]])).toBe(`"n" IS NULL`);
  });

  it("givenCompositeKey_whenConditionBuilt_thenOrOfConjunctions", () => {
    const columns = [
      { name: "a", type: "int" },
      { name: "b", type: "text" },
    ];

    expect(matchCondition(LANGUAGE, columns, [[1, "x"]])).toBe(`"a" = 1 AND "b" = 'x'`);
    expect(
      matchCondition(LANGUAGE, columns, [
        [1, "x"],
        [2, null],
      ]),
    ).toBe(`("a" = 1 AND "b" = 'x') OR ("a" = 2 AND "b" IS NULL)`);
  });

  it("givenBytesValue_whenConditionBuilt_thenInvalidRequest", () => {
    const bytes = { kind: "bytes", preview: "00", length: 1 } as const;

    expect(() => matchCondition(LANGUAGE, [{ name: "blob", type: "bytea" }], [[bytes]])).toThrow(CoreError);
  });
});

describe("submitEdits", () => {
  it("givenStatementsEachTouchingOneRow_whenSubmitted_thenCommittedInOneTransaction", async () => {
    const target = fake([1, 1]);
    const submitted = await submitEdits(target, ["DELETE a", "INSERT b"]);
    expect(submitted.rowsAffected).toBe(2);
    expect(target.log).toEqual(["mode manual", "DELETE a", "INSERT b", "commit", "mode auto"]);
  });

  it("givenUpdateAffectingZeroRows_whenSubmitted_thenRolledBackAndEditRejected", async () => {
    const target = fake([1, 0, 1]);
    const failure = await submitEdits(target, ["DELETE a", "UPDATE b", "INSERT c"]).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EditRejectedError);
    expect(failure).toMatchObject({ code: "editRejected", statementIndex: 1, statement: "UPDATE b" });
    expect((failure as Error).message).toContain("Statement 2 affected 0 rows");
    expect(target.log).toEqual(["mode manual", "DELETE a", "UPDATE b", "rollback", "mode auto"]);
  });

  it("givenFailingSecondStatement_whenSubmitted_thenFirstRolledBack", async () => {
    const target = fake([1, new PluginError("statementFailed", 'duplicate key value violates "orders_pk"')]);
    const failure = await submitEdits(target, ["UPDATE a", "INSERT b"]).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "editRejected", statementIndex: 1, statement: "INSERT b" });
    expect((failure as Error).message).toBe('Statement 2 failed: duplicate key value violates "orders_pk"');
    expect(target.log).toEqual(["mode manual", "UPDATE a", "INSERT b", "rollback", "mode auto"]);
  });

  it("givenNoStatements_whenSubmitted_thenNothingRuns", async () => {
    const target = fake([]);
    expect(await submitEdits(target, [])).toEqual({ statements: [], rowsAffected: 0 });
    expect(target.log).toEqual([]);
  });
});
