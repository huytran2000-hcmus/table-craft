import { DatabaseSync } from "node:sqlite";
import {
  PluginError,
  toWireInteger,
  toWireValue,
  z,
  type Capability,
  type Column,
  type DatasourcePlugin,
  type ExecuteResult,
  type PluginErrorCode,
  type Row,
  type Session,
  type WireValue,
} from "@table-craft/plugin-api";

const PLUGIN_ID = "sqlite";
/** No `cancel`: node:sqlite runs a statement synchronously, so nothing could deliver the request. */
const CAPABILITIES: readonly Capability[] = ["sql"];

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

class SqliteSession implements Session {
  readonly #database: DatabaseSync;

  constructor(config: SqliteConfig) {
    this.#database = new DatabaseSync(config.path);
  }

  execute(sql: string): Promise<ExecuteResult> {
    return settle("statementFailed", () => {
      const statement = this.#database.prepare(sql);
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

  close(): Promise<void> {
    return settle("statementFailed", () => this.#database.close());
  }
}

const plugin: DatasourcePlugin = {
  id: PLUGIN_ID,
  capabilities: CAPABILITIES,
  connectionSchema,
  connect: (config) => settle("connectionFailed", () => new SqliteSession(connectionSchema.parse(config))),
};

export default plugin;
