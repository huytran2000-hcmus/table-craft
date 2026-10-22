import pg from "pg";
import Cursor from "pg-cursor";
import {
  BYTES_PREVIEW_LENGTH,
  PluginError,
  toWireInteger,
  z,
  type Capability,
  type Column,
  type ConnectOptions,
  type DatasourcePlugin,
  type ExecuteResult,
  type Introspector,
  type Row,
  type Session,
  type SqlLanguage,
  type TransactionMode,
  type Transactions,
  type WireValue,
} from "@table-craft/plugin-api";
import {
  classifyTokens,
  defaultKeyword,
  defaultValuesInsert,
  quoteIdentifierWith,
  SQL_FUNCTIONS,
  SQL_KEYWORDS,
  sqlCompleter,
  sqlGenerator,
  sqlLiteral,
  sqlSplitter,
  transactionEffect,
  type SqlDialectOptions,
  type SqlLiteralOptions,
} from "@table-craft/plugin-api/sql";
import { postgresIntrospector } from "./introspect.js";

const PLUGIN_ID = "postgres";
const CAPABILITIES: readonly Capability[] = ["sql", "cancel", "schemaTree", "transactions", "ddl"];

/** Function bodies live in dollar quotes; `BEGIN ATOMIC … END` holds a SQL-standard body. */
const DIALECT: SqlDialectOptions = { dollarQuotes: true, nestedBlockComments: true, blockKeywords: ["BEGIN"] };

const LITERALS: SqlLiteralOptions = { backslashEscapes: false, bytes: (hex) => `'\\x${hex}'::bytea` };

const quoteIdentifier = quoteIdentifierWith('"');

/** An upper-case letter would fold away unquoted, so only lower case reads back as written. */
const PLAIN_IDENTIFIER = /^[a-z_][a-z0-9_$]*$/;
const KEYWORDS: readonly string[] = [...SQL_KEYWORDS, "ILIKE", "LATERAL", "RETURNING"];

const language: SqlLanguage = {
  split: sqlSplitter(DIALECT),
  classify: (sql) => classifyTokens(sql, DIALECT),
  quoteIdentifier,
  literal: (value) => sqlLiteral(value, LITERALS),
  emptyInsert: defaultValuesInsert,
  updateDefault: defaultKeyword,
  ...sqlCompleter({
    dialect: DIALECT,
    identifierFolding: "lower",
    plainIdentifier: PLAIN_IDENTIFIER,
    quoteIdentifier,
    keywords: KEYWORDS,
    functions: [...SQL_FUNCTIONS, "array_agg", "now", "string_agg", "to_char"],
  }),
  ...sqlGenerator({
    quoteIdentifier,
    updateDefault: defaultKeyword,
    plainIdentifier: PLAIN_IDENTIFIER,
    keywords: KEYWORDS,
  }),
};

const BEGIN_SQL = "BEGIN";
const COMMIT_SQL = "COMMIT";
const ROLLBACK_SQL = "ROLLBACK";
const OPEN_TRANSACTION_MESSAGE = "A transaction is open; commit or roll it back before switching to auto-commit.";
const BUSY_MESSAGE = "Another statement is still running in this session.";

const DEFAULT_PORT = 5432;
const MAX_PORT = 65_535;
const CONNECT_TIMEOUT_MS = 10_000;
/** Rows per cursor fetch: one result-window's worth, so the first window costs one round trip. */
const FETCH_ROWS = 500;
/** SQLSTATE `query_canceled`, raised by `pg_cancel_backend`. */
const QUERY_CANCELED = "57014";
const APPLICATION_NAME = "table-craft";

const SSL_MODES = ["disable", "require", "verify-full"] as const;

const connectionSchema = z.strictObject({
  host: z.string().min(1),
  port: z.number().int().min(1).max(MAX_PORT).default(DEFAULT_PORT),
  database: z.string().min(1),
  user: z.string().min(1),
  password: z.string().default(""),
  /** `require` encrypts without checking the certificate; `verify-full` checks it and the host name. */
  sslMode: z.enum(SSL_MODES).default("disable"),
});

type PostgresConfig = z.output<typeof connectionSchema>;

/** Type OIDs from `pg_type.dat` in the PostgreSQL source; they are fixed for built-in types. */
const OID = {
  bool: 16,
  bytea: 17,
  int8: 20,
  int2: 21,
  int4: 23,
  oid: 26,
  json: 114,
  float4: 700,
  float8: 701,
  jsonb: 3802,
} as const;

/** `\x` that starts every bytea in the default `bytea_output = hex`. */
const BYTEA_HEX_PREFIX = "\\x";
const HEX_DIGITS_PER_BYTE = 2;

type Cell = (text: string) => WireValue;

const asText: Cell = (text) => text;

function bytea(text: string): WireValue {
  const hex = text.startsWith(BYTEA_HEX_PREFIX) ? text.slice(BYTEA_HEX_PREFIX.length) : text;
  return {
    kind: "bytes",
    preview: hex.slice(0, BYTES_PREVIEW_LENGTH * HEX_DIGITS_PER_BYTE),
    length: hex.length / HEX_DIGITS_PER_BYTE,
  };
}

/**
 * Every value arrives as the server's text (the parsers below are identity), and only types whose
 * text a JavaScript value represents exactly become something else (decision 017). Dates,
 * timestamps and numerics stay text, so no client time zone or float rounding touches them.
 */
const CELLS: ReadonlyMap<number, Cell> = new Map<number, Cell>([
  [OID.bool, (text) => text === "t"],
  [OID.int2, Number],
  [OID.int4, Number],
  [OID.oid, Number],
  [OID.float4, Number],
  [OID.float8, Number],
  [OID.int8, toWireInteger],
  [OID.json, (text) => ({ kind: "json", text })],
  [OID.jsonb, (text) => ({ kind: "json", text })],
  [OID.bytea, bytea],
]);

const NO_ROWS: AsyncIterable<Row> = {
  [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }),
};

/** pg sets it from BackendKeyData but its typings omit it. */
interface WithBackendPid {
  readonly processID: number;
}

const TEXT_TYPES: pg.CustomTypesConfig = { getTypeParser: () => (text: string) => text };

function sslOption(mode: PostgresConfig["sslMode"]): pg.ClientConfig["ssl"] {
  switch (mode) {
    case "disable":
      return false;
    case "require":
      return { rejectUnauthorized: false };
    case "verify-full":
      return true;
  }
}

function clientConfig(config: PostgresConfig): pg.ClientConfig {
  return {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: sslOption(config.sslMode),
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    application_name: APPLICATION_NAME,
  };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function openClient(config: PostgresConfig): Promise<pg.Client> {
  const client = new pg.Client(clientConfig(config));
  try {
    await client.connect();
  } catch (cause) {
    throw new PluginError("connectionFailed", messageOf(cause), { cause });
  }
  return client;
}

interface Running {
  cancelRequested: boolean;
}

interface TransactionState {
  mode: TransactionMode;
  open: boolean;
}

function readBatch(cursor: Cursor<unknown[]>): Promise<{ rows: unknown[][]; result: pg.QueryResult }> {
  return new Promise((resolve, reject) => {
    cursor.read(FETCH_ROWS, (error, rows, result) => {
      // The typings say `undefined` on success; pg-cursor passes `null`.
      if (error == null) resolve({ rows, result });
      else reject(error);
    });
  });
}

const READ_ONLY_SQL = "SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY";
const VERSION_SQL = "SHOW server_version";

/** Distribution builds append a build note, as in `17.4 (Debian 17.4-1.pgdg120+2)`. */
function shortVersion(reported: string | undefined): string | null {
  const version = reported?.split(" (")[0]?.trim() ?? "";
  return version === "" ? null : version;
}

class PostgresSession implements Session {
  readonly #config: PostgresConfig;
  readonly #client: pg.Client;
  readonly #typeNames: ReadonlyMap<number, string>;
  /** Set by the client's `error` event; a broken connection is reported, not thrown at random. */
  #broken: Error | null = null;
  #running: Running | null = null;
  #cancelling: Promise<void> = Promise.resolve();
  readonly #transaction: TransactionState = { mode: "auto", open: false };

  readonly serverVersion: string | null;
  readonly introspector: Introspector;
  readonly transactions: Transactions;

  constructor(
    config: PostgresConfig,
    client: pg.Client,
    typeNames: ReadonlyMap<number, string>,
    serverVersion: string | null,
  ) {
    this.#config = config;
    this.#client = client;
    this.#typeNames = typeNames;
    this.serverVersion = serverVersion;
    this.introspector = postgresIntrospector(client);
    const state = this.#transaction;
    this.transactions = {
      setMode: (mode) => this.#setMode(mode),
      commit: () => this.#endTransaction(COMMIT_SQL),
      rollback: () => this.#endTransaction(ROLLBACK_SQL),
      get mode() {
        return state.mode;
      },
      get open() {
        return state.open;
      },
    };
    client.on("error", (error) => {
      this.#broken = error;
    });
  }

  static async open(config: PostgresConfig, options: ConnectOptions): Promise<PostgresSession> {
    const client = await openClient(config);
    try {
      if (options.readOnly) await client.query(READ_ONLY_SQL);
      const types = await client.query<{ oid: number; typname: string }>("SELECT oid, typname FROM pg_type");
      const version = await client.query<{ server_version: string }>(VERSION_SQL);
      return new PostgresSession(
        config,
        client,
        new Map(types.rows.map((type) => [type.oid, type.typname])),
        shortVersion(version.rows[0]?.server_version),
      );
    } catch (cause) {
      await client.end();
      throw new PluginError("connectionFailed", messageOf(cause), { cause });
    }
  }

  async execute(sql: string): Promise<ExecuteResult> {
    if (this.#broken !== null) {
      throw new PluginError("statementFailed", `The connection was lost: ${this.#broken.message}`);
    }
    if (this.#running !== null) throw new PluginError("statementFailed", BUSY_MESSAGE);
    await this.#cancelling.catch(() => undefined);
    const running: Running = { cancelRequested: false };
    this.#running = running;
    const effect = transactionEffect(sql, DIALECT);
    const state = this.#transaction;
    try {
      if (state.mode === "manual" && !state.open && effect === null) {
        await this.#client.query(BEGIN_SQL);
        state.open = true;
      }
    } catch (cause) {
      this.#running = null;
      throw this.#failure(cause, running);
    }
    const cursor = this.#client.query(new Cursor<unknown[]>(sql, undefined, { rowMode: "array", types: TEXT_TYPES }));
    try {
      const first = await readBatch(cursor).catch((cause: unknown) => {
        // A failed COMMIT still ends the transaction; a failed statement inside one leaves it open.
        if (effect === "end") state.open = false;
        throw cause;
      });
      if (effect !== null) state.open = effect === "begin";
      const fields = first.result.fields;
      if (fields.length === 0) {
        this.#running = null;
        return { columns: [], rows: NO_ROWS, rowsAffected: first.result.rowCount };
      }
      const columns: Column[] = fields.map((field) => ({
        name: field.name,
        type: this.#typeNames.get(field.dataTypeID) ?? null,
      }));
      const cells = fields.map((field) => CELLS.get(field.dataTypeID) ?? asText);
      return { columns, rows: this.#rows(cursor, running, first.rows, cells), rowsAffected: null };
    } catch (cause) {
      this.#running = null;
      throw this.#failure(cause, running);
    }
  }

  async *#rows(
    cursor: Cursor<unknown[]>,
    running: Running,
    first: unknown[][],
    cells: readonly Cell[],
  ): AsyncGenerator<Row, void, undefined> {
    let batch = first;
    let exhausted = false;
    try {
      while (batch.length > 0) {
        for (const values of batch) {
          yield values.map((value, index) => (value === null ? null : (cells[index] ?? asText)(value as string)));
        }
        try {
          batch = (await readBatch(cursor)).rows;
        } catch (cause) {
          exhausted = true;
          throw this.#failure(cause, running);
        }
      }
      exhausted = true;
    } finally {
      if (!exhausted) await cursor.close();
      this.#running = null;
    }
  }

  #failure(cause: unknown, running: Running): PluginError {
    const code = (cause as { code?: unknown }).code;
    if (running.cancelRequested || code === QUERY_CANCELED) {
      return new PluginError("cancelled", "The statement was cancelled.", { cause });
    }
    return new PluginError("statementFailed", messageOf(cause), { cause });
  }

  cancel(): Promise<void> {
    const running = this.#running;
    if (running === null) return Promise.resolve();
    running.cancelRequested = true;
    this.#cancelling = this.#cancelBackend();
    return this.#cancelling;
  }

  /** On a second connection, because the session's own is busy with the statement it cancels. */
  async #cancelBackend(): Promise<void> {
    const backendPid = (this.#client as pg.Client & WithBackendPid).processID;
    const canceller = await openClient(this.#config);
    try {
      await canceller.query("SELECT pg_cancel_backend($1)", [backendPid]);
    } finally {
      await canceller.end();
    }
  }

  #setMode(mode: TransactionMode): Promise<void> {
    if (mode === "auto" && this.#transaction.open) {
      return Promise.reject(new PluginError("statementFailed", OPEN_TRANSACTION_MESSAGE));
    }
    this.#transaction.mode = mode;
    return Promise.resolve();
  }

  async #endTransaction(sql: string): Promise<void> {
    if (!this.#transaction.open) return;
    if (this.#running !== null) throw new PluginError("statementFailed", BUSY_MESSAGE);
    try {
      await this.#client.query(sql);
    } catch (cause) {
      throw new PluginError("statementFailed", messageOf(cause), { cause });
    } finally {
      this.#transaction.open = false;
    }
  }

  async close(): Promise<void> {
    await this.#cancelling.catch(() => undefined);
    await this.#client.end();
  }
}

const plugin: DatasourcePlugin = {
  id: PLUGIN_ID,
  capabilities: CAPABILITIES,
  language,
  connectionSchema,
  connect: (config, options) => PostgresSession.open(connectionSchema.parse(config), options),
};

export default plugin;
