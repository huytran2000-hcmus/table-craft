import { DatabaseSync } from "node:sqlite";
import {
  toWireValue,
  z,
  type Capability,
  type DatasourcePlugin,
  type ExecuteResult,
  type Row,
  type Session,
} from "@table-craft/plugin-api";

const PLUGIN_ID = "sqlite";
const CAPABILITIES: readonly Capability[] = ["sql"];

const connectionSchema = z.strictObject({
  /** A file path, or `:memory:` for a private in-memory database. */
  path: z.string().min(1),
});

type SqliteConfig = z.infer<typeof connectionSchema>;

/** node:sqlite is synchronous; this turns a throw into a rejection, as the contract expects. */
function settle<T>(work: () => T): Promise<T> {
  return new Promise((resolve) => resolve(work()));
}

/** SQLite integers are 64-bit; only those beyond the safe range keep their bigint tag. */
function toCell(value: unknown): Row[number] {
  if (typeof value === "bigint" && value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER) {
    return Number(value);
  }
  return toWireValue(value);
}

function toRow(row: unknown): Row {
  return (row as unknown[]).map(toCell);
}

function readRows(rows: Iterator<unknown>): AsyncIterable<Row> {
  const iterator: AsyncIterator<Row> = {
    next: () =>
      settle((): IteratorResult<Row> => {
        const next = rows.next();
        return next.done === true ? { done: true, value: undefined } : { done: false, value: toRow(next.value) };
      }),
    return: () =>
      settle((): IteratorResult<Row> => {
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
    return settle(() => {
      const statement = this.#database.prepare(sql);
      statement.setReadBigInts(true);
      const columns = statement.columns().map((column) => ({ name: column.name, type: column.type }));
      if (columns.length === 0) {
        const { changes } = statement.run();
        return { columns, rows: readRows([].values()), rowsAffected: Number(changes) };
      }
      statement.setReturnArrays(true);
      return { columns, rows: readRows(statement.iterate()), rowsAffected: null };
    });
  }

  close(): Promise<void> {
    return settle(() => this.#database.close());
  }
}

const plugin: DatasourcePlugin = {
  id: PLUGIN_ID,
  capabilities: CAPABILITIES,
  connectionSchema,
  connect: (config) => settle(() => new SqliteSession(connectionSchema.parse(config))),
};

export default plugin;
