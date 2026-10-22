import type { z } from "zod";
import type { Introspector, Relation } from "./catalog.js";
import type {
  CompletionCatalog,
  CompletionRequest,
  CompletionResult,
  Declaration,
  ResolveRequest,
} from "./completion.js";
import type { WireValue } from "./values.js";

/**
 * What a plugin can do. The UI branches on these, never on a plugin id (decision 007), and a
 * capability without contract-suite coverage cannot be declared (decision 013).
 */
export const CAPABILITIES = ["sql", "cancel", "schemaTree", "transactions", "ddl"] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Statements `SqlLanguage.generate` writes from a catalog relation (plan 010). */
export const GENERATED_STATEMENTS = ["drop", "select", "insert", "update"] as const;

export type GeneratedStatement = (typeof GENERATED_STATEMENTS)[number];

export interface Column {
  readonly name: string;
  /** The type the database reports, verbatim; null when it reports none. */
  readonly type: string | null;
}

export type Row = readonly WireValue[];

export interface ExecuteResult {
  /** Empty for a statement that returns no rows. */
  readonly columns: readonly Column[];
  /** Pulled lazily, so the host decides how many rows to fetch. */
  readonly rows: AsyncIterable<Row>;
  /** Null when the database does not report it, or the statement returns rows. */
  readonly rowsAffected: number | null;
}

export interface Session {
  /**
   * Rejects with a `PluginError`: `cancelled` when `cancel` interrupted it, `statementFailed`
   * otherwise. A session runs one statement at a time.
   */
  execute(sql: string): Promise<ExecuteResult>;
  /**
   * Present exactly when the plugin declares `cancel`. Interrupts the running statement, which
   * then rejects with `cancelled`, and leaves the session usable; a no-op when nothing runs.
   */
  cancel?(): Promise<void>;
  /** Present exactly when the plugin declares `schemaTree`. */
  readonly introspector?: Introspector;
  /** Present exactly when the plugin declares `transactions`. A new session starts in `auto`. */
  readonly transactions?: Transactions;
  close(): Promise<void>;
  /** What the server reports about itself, such as `17.4`; null when it reports nothing. */
  readonly serverVersion: string | null;
}

export interface ConnectOptions {
  /**
   * Ask the database to refuse writes for the whole session (decision 011). A guard against
   * accidents, not a security boundary: a statement can switch it back off.
   */
  readonly readOnly: boolean;
}

/** One statement of a script, in UTF-16 offsets into the text `split` received (decision 023). */
export interface StatementSpan {
  readonly from: number;
  readonly to: number;
  /** `text.slice(from, to)`: the statement without its delimiter. */
  readonly sql: string;
}

export const STATEMENT_KINDS = ["read", "write", "ddl", "transaction", "other"] as const;

export type StatementKind = (typeof STATEMENT_KINDS)[number];

export interface StatementClass {
  readonly kind: StatementKind;
  /** Why the statement needs confirmation before it runs (decision 011), such as `DELETE without WHERE`; null when it does not. */
  readonly destructive: string | null;
}

/** What the console asks the plugin about its dialect (decision 008); the host never parses SQL. */
export interface SqlLanguage {
  /** Every non-empty statement in `text`, in order. Comments and blanks between statements belong to none. */
  split(text: string): readonly StatementSpan[];
  classify(sql: string): StatementClass;
  /** `name` quoted as an identifier, whatever characters it holds. */
  quoteIdentifier(name: string): string;
  /**
   * `value` as a literal a statement can insert into a column of `columnType`. A bytes value
   * carries only its preview, so a longer one is written clipped with a comment saying so.
   */
  literal(value: WireValue, columnType: string | null): string;
  /** An `INSERT` into `qualifiedTable` where every column takes its default (decision 026). */
  emptyInsert(qualifiedTable: string): string;
  /**
   * What `UPDATE … SET column = …` writes to give a column its default: `DEFAULT` where the dialect
   * accepts it, else the catalog's `defaultExpression` (`ColumnMeta.default`), or `NULL` without one.
   */
  updateDefault(defaultExpression: string | null): string;
  /**
   * What fits at the caret, read from `catalog` (decision 028). Never rejects for SQL it cannot
   * read: it offers less. `sqlCompleter` in `@table-craft/plugin-api/sql` implements it.
   */
  complete(request: CompletionRequest, catalog: CompletionCatalog): Promise<CompletionResult>;
  /** Where the name at the caret was declared; null when it names nothing the scope or catalog knows. */
  resolve(request: ResolveRequest, catalog: CompletionCatalog): Promise<Declaration | null>;
  /**
   * A `statement` over `relation` for the SQL Generator (decision 029): one clause per line, columns
   * in table order, names quoted only where needed; `qualifiedName` is what the introspector names
   * the relation. A generated UPDATE matches no row until its `NULL`s are edited. `sqlGenerator` in
   * `@table-craft/plugin-api/sql` implements it.
   */
  generate(statement: GeneratedStatement, relation: Relation, qualifiedName: string): string;
}

export const TRANSACTION_MODES = ["auto", "manual"] as const;

export type TransactionMode = (typeof TRANSACTION_MODES)[number];

/**
 * Transaction control for one session (decision 011). In `manual` the plugin opens a transaction
 * before the first statement; in `auto` it tracks the ones a statement opens or ends explicitly.
 */
export interface Transactions {
  /** Rejects with `statementFailed` when leaving `manual` while a transaction is open: commit or roll back first. */
  setMode(mode: TransactionMode): Promise<void>;
  /** A no-op when no transaction is open. */
  commit(): Promise<void>;
  /** A no-op when no transaction is open. */
  rollback(): Promise<void>;
  readonly mode: TransactionMode;
  /** Whether a transaction is open after the last statement, commit or rollback. */
  readonly open: boolean;
}

/** The default export of a plugin's entry module (decision 005). */
export interface DatasourcePlugin {
  readonly id: string;
  readonly capabilities: readonly Capability[];
  /** Present exactly when the plugin declares `sql`. */
  readonly language?: SqlLanguage;
  /** Validates the configuration `connect` receives; the host parses before it calls. */
  readonly connectionSchema: z.ZodType;
  /** Rejects with a `PluginError` coded `connectionFailed` when the database cannot be reached. */
  connect(config: unknown, options: ConnectOptions): Promise<Session>;
}
