import { DatabaseSync } from "node:sqlite";
import {
  PluginError,
  toWireInteger,
  toWireValue,
  z,
  type Capability,
  type Column,
  type ConnectOptions,
  type DatasourcePlugin,
  type ExecuteResult,
  type ExplainedPlan,
  type ExplainOptions,
  type Introspector,
  type PluginErrorCode,
  type Row,
  type Session,
  type SqlLanguage,
  type TransactionMode,
  type Transactions,
  type WireValue,
} from "@table-craft/plugin-api";
import {
  classifyTokens,
  defaultValuesInsert,
  quoteIdentifierWith,
  SQL_FUNCTIONS,
  SQL_KEYWORDS,
  sqlCompleter,
  sqlExplainable,
  sqlGenerator,
  sqlLiteral,
  sqlSplitter,
  transactionEffect,
  type SqlDialectOptions,
  type SqlLiteralOptions,
} from "@table-craft/plugin-api/sql";
import { EXPLAIN_VERBS, explainStatement, readPlanRows } from "./explain.js";
import { sqliteIntrospector } from "./introspect.js";

const PLUGIN_ID = "sqlite";
/** No `cancel`: node:sqlite runs a statement synchronously, so nothing could deliver the request. */
const CAPABILITIES: readonly Capability[] = ["sql", "schemaTree", "transactions", "ddl", "explain"];

/** Trigger bodies are `BEGIN … END` and hold semicolons. */
const DIALECT: SqlDialectOptions = { blockKeywords: ["BEGIN"] };

const LITERALS: SqlLiteralOptions = { backslashEscapes: false, bytes: (hex) => `X'${hex}'` };

const quoteIdentifier = quoteIdentifierWith('"');
/** SQLite has no `DEFAULT` inside `SET`; `dflt_value` is the declared expression, valid SQL as written. */
const updateDefault = (expression: string | null): string => expression ?? "NULL";

const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;
const KEYWORDS: readonly string[] = [...SQL_KEYWORDS, "GLOB", "PRAGMA"];

/** No `explainAnalyze`: SQLite's `EXPLAIN QUERY PLAN` only plans, and nothing else reports run times. */
const { explainable } = sqlExplainable({ dialect: DIALECT, name: "SQLite", verbs: EXPLAIN_VERBS, analyzeVerbs: [] });

const language: SqlLanguage = {
  split: sqlSplitter(DIALECT),
  classify: (sql) => classifyTokens(sql, DIALECT),
  quoteIdentifier,
  literal: (value) => sqlLiteral(value, LITERALS),
  emptyInsert: defaultValuesInsert,
  updateDefault,
  ...sqlCompleter({
    dialect: DIALECT,
    identifierFolding: "none",
    plainIdentifier: PLAIN_IDENTIFIER,
    quoteIdentifier,
    keywords: KEYWORDS,
    functions: [...SQL_FUNCTIONS, "date", "datetime", "group_concat", "ifnull", "json_extract"],
  }),
  ...sqlGenerator({ quoteIdentifier, updateDefault, plainIdentifier: PLAIN_IDENTIFIER, keywords: KEYWORDS }),
  explainable,
};

const BEGIN_SQL = "BEGIN";
const COMMIT_SQL = "COMMIT";
const ROLLBACK_SQL = "ROLLBACK";
const OPEN_TRANSACTION_MESSAGE = "A transaction is open; commit or roll it back before switching to auto-commit.";

const connectionSchema = z.strictObject({
  /** A file path, or `:memory:` for a private in-memory database. */
  path: z.string().min(1),
});

type SqliteConfig = z.infer<typeof connectionSchema>;

/**
 * SQLite stores booleans as integers and JSON as text; the declared column type is the only
 * place the intent survives, so it decides the wire value (decision 017).
 */
const BOOLEAN_DECLARATION = /^BOOL(EAN)?$/i;
const JSON_DECLARATION = /^JSONB?$/i;

type Cell = (value: unknown) => WireValue;

function plainCell(value: unknown): WireValue {
  return typeof value === "bigint" ? toWireInteger(value) : toWireValue(value);
}

function cellFor(column: Column): Cell {
  const declared = column.type ?? "";
  if (BOOLEAN_DECLARATION.test(declared)) {
    return (value) => (value === 0n || value === 1n ? value === 1n : plainCell(value));
  }
  if (JSON_DECLARATION.test(declared)) {
    return (value) => (typeof value === "string" ? { kind: "json", text: value } : plainCell(value));
  }
  return plainCell;
}

/** node:sqlite is synchronous; this turns a throw into a rejection coded as the contract expects. */
// eslint-disable-next-line @typescript-eslint/require-await -- async is what turns the throw into a rejection
async function settle<T>(code: PluginErrorCode, work: () => T): Promise<T> {
  try {
    return work();
  } catch (cause) {
    throw new PluginError(code, cause instanceof Error ? cause.message : String(cause), { cause });
  }
}

function readRows(rows: Iterator<unknown>, cells: readonly Cell[]): AsyncIterable<Row> {
  const iterator: AsyncIterator<Row> = {
    next: () =>
      settle("statementFailed", (): IteratorResult<Row> => {
        const next = rows.next();
        if (next.done === true) return { done: true, value: undefined };
        const values = next.value as unknown[];
        return { done: false, value: values.map((value, index) => (cells[index] ?? plainCell)(value)) };
      }),
    return: () =>
      settle("statementFailed", (): IteratorResult<Row> => {
        rows.return?.();
        return { done: true, value: undefined };
      }),
  };
  return { [Symbol.asyncIterator]: () => iterator };
}

const VERSION_SQL = "SELECT sqlite_version() AS version";
/** Refuses every write on this connection, temporary tables included. */
const READ_ONLY_SQL = "PRAGMA query_only = ON";

/**
 * SQLite reports whether a transaction is open (`isTransaction`), so `open` is read, not tracked.
 * Everything runs synchronously, so every method has settled before it returns.
 */
class SqliteSession implements Session {
  readonly #database: DatabaseSync;
  #mode: TransactionMode = "auto";
  readonly serverVersion: string | null;
  readonly introspector: Introspector;
  readonly transactions: Transactions;

  constructor(config: SqliteConfig, options: ConnectOptions) {
    this.#database = new DatabaseSync(config.path);
    this.introspector = sqliteIntrospector(this.#database);
    const database = this.#database;
    const mode = (): TransactionMode => this.#mode;
    this.transactions = {
      setMode: (next) =>
        settle("statementFailed", () => {
          if (next === "auto" && database.isTransaction) throw new Error(OPEN_TRANSACTION_MESSAGE);
          this.#mode = next;
        }),
      commit: () => this.#end(COMMIT_SQL),
      rollback: () => this.#end(ROLLBACK_SQL),
      get mode() {
        return mode();
      },
      get open() {
        return database.isOpen && database.isTransaction;
      },
    };
    if (options.readOnly) this.#database.exec(READ_ONLY_SQL);
    const row = this.#database.prepare(VERSION_SQL).get();
    this.serverVersion = typeof row?.version === "string" ? row.version : null;
  }

  execute(sql: string): Promise<ExecuteResult> {
    return settle("statementFailed", () => {
      const database = this.#database;
      if (this.#mode === "manual" && !database.isTransaction && transactionEffect(sql, DIALECT) === null) {
        database.exec(BEGIN_SQL);
      }
      const statement = database.prepare(sql);
      statement.setReadBigInts(true);
      const columns: Column[] = statement.columns().map((column) => ({ name: column.name, type: column.type }));
      if (columns.length === 0) {
        const { changes } = statement.run();
        return { columns, rows: readRows([].values(), []), rowsAffected: Number(changes) };
      }
      statement.setReturnArrays(true);
      return { columns, rows: readRows(statement.iterate(), columns.map(cellFor)), rowsAffected: null };
    });
  }

  async explain(sql: string, options: ExplainOptions): Promise<ExplainedPlan> {
    const verdict = explainable(sql, options);
    if (!verdict.ok) throw new PluginError("explainUnsupported", verdict.reason);
    const statement = explainStatement(sql);
    const rows: Row[] = [];
    for await (const row of (await this.execute(statement)).rows) rows.push(row);
    return readPlanRows(rows, statement);
  }

  #end(sql: string): Promise<void> {
    return settle("statementFailed", () => {
      if (this.#database.isTransaction) this.#database.exec(sql);
    });
  }

  close(): Promise<void> {
    return settle("statementFailed", () => this.#database.close());
  }
}

const plugin: DatasourcePlugin = {
  id: PLUGIN_ID,
  capabilities: CAPABILITIES,
  language,
  connectionSchema,
  connect: (config, options) =>
    settle("connectionFailed", () => new SqliteSession(connectionSchema.parse(config), options)),
};

export default plugin;
