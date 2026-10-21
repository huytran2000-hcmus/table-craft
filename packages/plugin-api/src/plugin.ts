import type { z } from "zod";
import type { Introspector } from "./catalog.js";
import type { WireValue } from "./values.js";

/**
 * What a plugin can do. The UI branches on these, never on a plugin id (decision 007), and a
 * capability without contract-suite coverage cannot be declared (decision 013).
 */
export const CAPABILITIES = ["sql", "cancel", "schemaTree"] as const;

export type Capability = (typeof CAPABILITIES)[number];

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

/** The default export of a plugin's entry module (decision 005). */
export interface DatasourcePlugin {
  readonly id: string;
  readonly capabilities: readonly Capability[];
  /** Validates the configuration `connect` receives; the host parses before it calls. */
  readonly connectionSchema: z.ZodType;
  /** Rejects with a `PluginError` coded `connectionFailed` when the database cannot be reached. */
  connect(config: unknown, options: ConnectOptions): Promise<Session>;
}
