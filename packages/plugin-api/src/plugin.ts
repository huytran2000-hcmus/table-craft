import type { z } from "zod";
import type { WireValue } from "./values.js";

/**
 * What a plugin can do. The UI branches on these, never on a plugin id (decision 007), and a
 * capability without contract-suite coverage cannot be declared (decision 013).
 */
export const CAPABILITIES = ["sql"] as const;

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
  execute(sql: string): Promise<ExecuteResult>;
  close(): Promise<void>;
}

/** The default export of a plugin's entry module (decision 005). */
export interface DatasourcePlugin {
  readonly id: string;
  readonly capabilities: readonly Capability[];
  /** Validates the configuration `connect` receives; the host parses before it calls. */
  readonly connectionSchema: z.ZodType;
  connect(config: unknown): Promise<Session>;
}
