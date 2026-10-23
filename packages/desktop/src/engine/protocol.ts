/**
 * Every message between the renderer and an engine host (decision 002). The renderer may not
 * import core or plugin-api, so the wire types and constants both sides need are restated here
 * and pinned to their originals by `test/desktop/protocol.test.ts`.
 */

/** Mirrors `RESULT_WINDOW_ROWS` in core: the most rows one `result.window` returns. */
export const RESULT_WINDOW_ROWS = 500;
/** Mirrors `RESULT_PAGE_ROWS` in core: the default page, before the user's setting (decision 032). */
export const RESULT_PAGE_ROWS = 500;
/** Mirrors `RESULT_FETCH_ALL_CAP` in core: the default Fetch All cap, before the user's setting. */
export const RESULT_FETCH_ALL_CAP = 100_000;

/** What main posts on the engine's parent port, once, before any renderer port arrives. */
export const ENGINE_BOOT_MESSAGE = "engine.boot";
/** What main posts on the engine's parent port alongside a fresh renderer port. */
export const ENGINE_PORT_MESSAGE = "engine.port";
/** What main posts on the engine's parent port to have it close every session and exit. */
export const ENGINE_SHUTDOWN_MESSAGE = "engine.shutdown";
/** What a probe engine posts on its parent port, once, before it exits. */
export const ENGINE_PROBED_MESSAGE = "engine.probed";

/** Mirrors `WireValue` in plugin-api. */
export type WireValue =
  | null
  | boolean
  | number
  | string
  | { readonly kind: "bigint"; readonly value: string }
  | { readonly kind: "bytes"; readonly preview: string; readonly length: number }
  | { readonly kind: "json"; readonly text: string }
  | { readonly kind: "date"; readonly iso: string };

export type Row = readonly WireValue[];

/** Mirrors `Column` in plugin-api. */
export interface Column {
  readonly name: string;
  readonly type: string | null;
}

/** Mirrors `Capability` in plugin-api. The renderer branches on these, never on a plugin id (decision 007). */
export type Capability = "sql" | "cancel" | "schemaTree" | "transactions" | "ddl" | "explain" | "explainAnalyze";

/** What the SQL Generator writes: `create` is the relation's definition, the rest mirror `GeneratedStatement` in plugin-api. */
export type GeneratorStatement = "create" | "drop" | "select" | "insert" | "update";

/** Mirrors `StatementKind` in plugin-api. */
export type StatementKind = "read" | "write" | "ddl" | "transaction" | "other";

/** Mirrors `TransactionMode` in plugin-api: `auto` commits each statement, `manual` holds one transaction open. */
export type TransactionMode = "auto" | "manual";

/** Mirrors `ParameterStyle` in plugin-api. */
export type ParameterStyle = "named" | "numbered" | "positional";

/** Mirrors `SqlParameter` in plugin-api: a placeholder, in offsets into its statement's `sql`. */
export interface StatementParameter {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly style: ParameterStyle;
}

/** Mirrors `ParameterValue` in plugin-api: text the server casts, or SQL NULL (decision 043). */
export type ParameterValue = string | null;

/** One statement of a script: its span in UTF-16 offsets, as the plugin split it, and its class. */
export interface ClassifiedStatement {
  readonly from: number;
  readonly to: number;
  readonly sql: string;
  readonly kind: StatementKind;
  /** Why the console asks before running it, such as `DELETE without WHERE`; null when it need not. */
  readonly destructive: string | null;
  /** The placeholders the plugin finds in `sql`, in order. */
  readonly parameters: readonly StatementParameter[];
}

/** Mirrors `KEYWORD_CASES` in plugin-api. */
export const KEYWORD_CASES = ["upper", "lower", "preserve"] as const;

export type KeywordCase = (typeof KEYWORD_CASES)[number];

/** Mirrors `FormatOptions` in plugin-api (decision 042). */
export interface FormatOptions {
  readonly keywordCase: KeywordCase;
  readonly indentWidth: number;
  readonly linesBetweenStatements: number;
}

/** A session's transaction after a transaction request. */
export interface TransactionState {
  readonly mode: TransactionMode;
  readonly transactionOpen: boolean;
}

/** Mirrors `Namespace` in plugin-api. */
export interface Namespace {
  readonly path: readonly string[];
  readonly name: string;
  readonly kind: "database" | "schema";
  readonly system: boolean;
  readonly current: boolean;
}

/** Mirrors `ColumnMeta` in plugin-api. */
export interface ColumnMeta {
  readonly name: string;
  readonly position: number;
  readonly type: string;
  readonly nullable: boolean;
  readonly default: string | null;
  readonly comment: string | null;
  readonly autoIncrement: boolean;
}

/** Mirrors `Key` in plugin-api. */
export interface Key {
  readonly name: string;
  readonly columns: readonly string[];
}

/** Mirrors `ForeignKey` in plugin-api. */
export interface ForeignKey {
  readonly name: string;
  readonly columns: readonly string[];
  readonly target: {
    readonly path: readonly string[];
    readonly relation: string;
    readonly columns: readonly string[];
  };
  readonly onDelete: string;
  readonly onUpdate: string;
}

/** Mirrors `Index` in plugin-api. */
export interface Index {
  readonly name: string;
  readonly columns: readonly string[];
  readonly unique: boolean;
  readonly primary: boolean;
}

/** Mirrors `RelationKind` in plugin-api. */
export type RelationKind = "table" | "view" | "materializedView";

/** Mirrors `Relation` in plugin-api. */
export interface Relation {
  readonly name: string;
  readonly kind: RelationKind;
  readonly comment: string | null;
  readonly columns: readonly ColumnMeta[];
  readonly primaryKey: Key | null;
  readonly uniqueKeys: readonly Key[];
  readonly foreignKeys: readonly ForeignKey[];
  readonly indexes: readonly Index[];
}

/** Mirrors `Routine` in plugin-api. */
export interface Routine {
  readonly name: string;
  readonly kind: "function" | "procedure";
}

/** Mirrors `Sequence` in plugin-api. */
export interface Sequence {
  readonly name: string;
}

/** Mirrors `NamespaceCatalog` in plugin-api. */
export interface NamespaceCatalog {
  readonly path: readonly string[];
  readonly relations: readonly Relation[];
  readonly routines: readonly Routine[];
  readonly sequences: readonly Sequence[];
}

/** Mirrors `CachedCatalog` in core: a catalog and when, and how fast, it was read. */
export interface DescribedCatalog {
  readonly catalog: NamespaceCatalog;
  /** Epoch milliseconds. */
  readonly introspectedAt: number;
  readonly elapsedMs: number;
}

/**
 * The one datasource an engine host serves. Main assembles it from `datasources.json` and the
 * secret store, so `config` carries decrypted secrets and never travels to the renderer.
 */
export interface DatasourceConfig {
  readonly id: string;
  readonly pluginId: string;
  readonly config: unknown;
  /** Every session asks the database to refuse writes (decision 011). */
  readonly readOnly: boolean;
}

/** `serve` answers renderer ports until the last closes; `probe` tests one connection and exits. */
export type EngineMode = "serve" | "probe";

export interface EngineBoot {
  readonly kind: typeof ENGINE_BOOT_MESSAGE;
  readonly mode: EngineMode;
  readonly datasource: DatasourceConfig;
  /** Directories whose subdirectories are plugins, in precedence order (decision 005). */
  readonly pluginRoots: readonly string[];
}

/** What Test Connection shows: the server that answered, or why none did. */
export type ProbeResult =
  | {
      readonly ok: true;
      readonly pluginName: string;
      readonly serverVersion: string | null;
      readonly elapsedMs: number;
    }
  | { readonly ok: false; readonly error: EngineError };

export interface EngineProbed {
  readonly kind: typeof ENGINE_PROBED_MESSAGE;
  readonly result: ProbeResult;
}

export interface ResultWindow {
  readonly offset: number;
  readonly rows: readonly Row[];
}

/** Mirrors `TypeClass` in core: what a column holds, for its header glyph. */
export type TypeClass = "integer" | "float" | "decimal" | "boolean" | "temporal" | "json" | "bytes" | "text";

/** Mirrors `ResultState` in core: how far a result has been read, and whether more can be. */
export interface ResultState {
  readonly rowCount: number;
  readonly complete: boolean;
  readonly cursorOpen: boolean;
}

/** Mirrors `SortDirection` in core. */
export type SortDirection = "asc" | "desc";

/** Mirrors `SortKey` in core: a column index and its direction. */
export interface SortKey {
  readonly column: number;
  readonly direction: SortDirection;
}

/** Mirrors `EXTRACTOR_KINDS` in core: the formats Copy and Export write. */
export const EXTRACTOR_KINDS = ["csv", "tsv", "json", "sqlInsert", "markdown"] as const;
export type ExtractorKind = (typeof EXTRACTOR_KINDS)[number];

/** Rows `from` up to but not including `to`, in the result's current sort order. */
export interface RowRange {
  readonly from: number;
  readonly to: number;
}

/** What `result.export` wrote. */
export interface ExportedResult {
  readonly path: string;
  readonly rows: number;
  readonly bytes: number;
  readonly elapsedMs: number;
}

/** Mirrors `ResultSummary` in core, with the first window and the session's transaction attached. */
export interface ExecutedStatement extends ResultState {
  readonly handle: string;
  readonly columns: readonly Column[];
  readonly typeClasses: readonly TypeClass[];
  readonly rowsAffected: number | null;
  readonly firstWindow: ResultWindow;
  /** Whether the session holds a transaction open after the statement; always false without `transactions`. */
  readonly transactionOpen: boolean;
}

/** Mirrors `CellInput` in core: text the database casts, `NULL`, or the column's default. */
export type CellInput =
  { readonly kind: "text"; readonly text: string } | { readonly kind: "null" } | { readonly kind: "default" };

/** Mirrors `RowEdit` in core; `row` indexes the table result's held rows. */
export type RowEdit =
  | {
      readonly kind: "update";
      readonly row: number;
      readonly values: readonly { readonly column: number; readonly value: CellInput }[];
    }
  | { readonly kind: "insert"; readonly values: readonly CellInput[] }
  | { readonly kind: "delete"; readonly row: number };

/** Mirrors `EditableIdentity` in core: the key columns that name a row, or why the table is read-only. */
export type EditableIdentity = { readonly identity: readonly string[] } | { readonly readOnly: string };

/** What `table.query` answers: the rows, the SQL that read them, and how they may be edited (decision 026). */
export interface TableQuery {
  readonly statement: ExecutedStatement;
  readonly sql: string;
  readonly editable: EditableIdentity;
  /** The catalog's view of each result column, in result order. */
  readonly columns: readonly ColumnMeta[];
  /** The table's own foreign keys, for go-to-referenced. */
  readonly foreignKeys: readonly ForeignKey[];
  /** Foreign keys of described tables that point at this one, for show-referencing. */
  readonly referencing: readonly ReferencingKey[];
}

/** A foreign key of the relation at `path`.`relation` that points at another table. */
export interface ReferencingKey {
  readonly path: readonly string[];
  readonly relation: string;
  readonly foreignKey: ForeignKey;
}

/** Mirrors `SubmittedEdits` in core. */
export interface SubmittedEdits {
  readonly statements: readonly string[];
  readonly rowsAffected: number;
}

/** A column a value condition matches on: the result column whose values it reads, written as `name`. */
export interface ConditionColumn {
  readonly column: number;
  readonly name: string;
}

/** Mirrors `OrderTerm` in core: one ORDER BY term by column name. */
export interface OrderTerm {
  readonly name: string;
  readonly direction: SortDirection;
}

/** Mirrors `COMPLETION_KINDS` in plugin-api. */
export const COMPLETION_KINDS = [
  "namespace",
  "table",
  "view",
  "column",
  "alias",
  "cte",
  "join",
  "function",
  "keyword",
] as const;

export type CompletionKind = (typeof COMPLETION_KINDS)[number];

/** Mirrors `CompletionItem` in plugin-api. */
export interface CompletionItem {
  readonly label: string;
  readonly kind: CompletionKind;
  readonly detail: string | null;
  readonly apply: string;
  readonly boost: number;
}

/** Mirrors `CompletionScope` in plugin-api: the table a clause body is written against. */
export interface CompletionScope {
  readonly path: readonly string[];
  readonly relation: string;
}

/** Mirrors `CompletionResult` in plugin-api. */
export interface CompletionResult {
  readonly from: number;
  readonly to: number;
  readonly items: readonly CompletionItem[];
  /** A regular expression source the editor may keep filtering with; null to ask on every keystroke. */
  readonly validFor: string | null;
}

/** Mirrors `Declaration` in plugin-api. */
export type Declaration =
  | { readonly kind: "alias" | "cte"; readonly from: number; readonly to: number }
  | { readonly kind: "relation"; readonly path: readonly string[]; readonly relation: string }
  | { readonly kind: "column"; readonly path: readonly string[]; readonly relation: string; readonly column: string };

/** Mirrors `Explainability` in plugin-api. */
export type Explainability =
  { readonly ok: true; readonly writes: boolean } | { readonly ok: false; readonly reason: string };

/** Mirrors `PlanProperty` in plugin-api. */
export interface PlanProperty {
  readonly name: string;
  readonly value: string;
}

/** Mirrors `PlanNode` in plugin-api: one operator of the plan, numbers or null where the dialect says nothing. */
export interface PlanNode {
  readonly operation: string;
  readonly target: string | null;
  readonly detail: string | null;
  readonly estimatedRows: number | null;
  readonly estimatedCost: number | null;
  readonly actualRows: number | null;
  readonly actualTimeMs: number | null;
  readonly loops: number | null;
  readonly properties: readonly PlanProperty[];
  readonly children: readonly PlanNode[];
}

/** Mirrors `ExplainedPlan` in plugin-api. */
export interface ExplainedPlan {
  /** The EXPLAIN statement the plugin sent. */
  readonly statement: string;
  readonly analyzed: boolean;
  readonly roots: readonly PlanNode[];
  readonly summary: readonly PlanProperty[];
  /** What the database printed, for the Raw view. */
  readonly raw: string;
}

export interface ExplainedStatement {
  readonly plan: ExplainedPlan;
  /** Whether the session's transaction is open after the explain, as `ExecutedStatement` reports it. */
  readonly transactionOpen: boolean;
}

export interface OpenedSession {
  readonly sessionId: string;
  /** The datasource's plugin, by its manifest name, for display only. */
  readonly pluginName: string;
  readonly capabilities: readonly Capability[];
  /** What the server reports about itself, for the status bar; null when it reports nothing. */
  readonly serverVersion: string | null;
}

/**
 * The user's paging preferences, sent with every call that reads rows, because the engine keeps no
 * preferences of its own (decision 032).
 */
export interface ResultPaging {
  /** Rows read when the statement runs, and per Fetch Next Page. */
  readonly pageRows: number;
  /** The most rows the result holds; Fetch All stops there and closes the cursor. */
  readonly fetchAllCap: number;
}

/** The engine's calls: what each request carries and what its response answers with. */
export interface EngineCalls {
  "session.open": { params: Record<never, never>; result: OpenedSession };
  /** Closes the session and releases every result it produced. */
  "session.close": { params: { readonly sessionId: string }; result: null };
  /**
   * With `parameters`, the plugin binds them to the placeholders in `sql` (decision 043); a name
   * without a value fails with `statementFailed`. Without, `sql` runs verbatim.
   */
  "statement.execute": {
    params: {
      readonly sessionId: string;
      readonly sql: string;
      readonly parameters?: Readonly<Record<string, ParameterValue>>;
    } & ResultPaging;
    result: ExecutedStatement;
  };
  /** Cancels the statement running in the session, if any; its `statement.execute` fails with `cancelled`. */
  "statement.cancel": { params: { readonly sessionId: string }; result: null };
  /** Splits and classifies `text` with the datasource plugin's language; needs no session. */
  "script.split": { params: { readonly text: string }; result: readonly ClassifiedStatement[] };
  /** `text` laid out by the plugin's language (decision 042); fails with `formatFailed` and the reason. Needs no session. */
  "sql.format": { params: { readonly text: string; readonly options: FormatOptions }; result: string };
  /** Whether the plugin's language can explain `sql` (one statement), and whether it writes; needs no session. Needs `explain`. */
  "sql.explainable": {
    params: { readonly sql: string; readonly analyze: boolean };
    result: Explainability;
  };
  /**
   * Explains `sql` on the session, closing its open cursor first; with `analyze` the statement runs
   * (decision 031) and `statement.cancel` stops it. Needs `explain`, and `explainAnalyze` for `analyze`.
   */
  "statement.explain": {
    params: { readonly sessionId: string; readonly sql: string; readonly analyze: boolean };
    result: ExplainedStatement;
  };
  /** Switching to `auto` while a transaction is open fails with `statementFailed`. Needs `transactions`. */
  "transaction.setMode": {
    params: { readonly sessionId: string; readonly mode: TransactionMode };
    result: TransactionState;
  };
  /** Commits the open transaction; does nothing when none is open. Needs `transactions`. */
  "transaction.commit": { params: { readonly sessionId: string }; result: TransactionState };
  /** Rolls back the open transaction; does nothing when none is open. Needs `transactions`. */
  "transaction.rollback": { params: { readonly sessionId: string }; result: TransactionState };
  "result.window": {
    params: { readonly handle: string; readonly offset: number; readonly limit: number };
    result: ResultWindow;
  };
  /** Closes the result's cursor and drops its rows. */
  "result.release": { params: { readonly handle: string }; result: null };
  /** Reads one more page, or with `all` up to `fetchAllCap`; a no-op once the cursor is closed. */
  "result.fetchMore": {
    params: { readonly handle: string; readonly all: boolean } & ResultPaging;
    result: ResultState;
  };
  /** Ends a running fetch after its current row; the cursor stays open. */
  "result.stopFetch": { params: { readonly handle: string }; result: ResultState };
  /** Sorts the held rows in the engine; windows read through the new order. No keys restores it. */
  "result.sort": { params: { readonly handle: string; readonly keys: readonly SortKey[] }; result: ResultState };
  /** The given rows and columns as `extractor` text, for the clipboard. */
  "result.extract": {
    params: {
      readonly handle: string;
      readonly extractor: ExtractorKind;
      readonly rows: readonly RowRange[];
      readonly columns: readonly number[];
    };
    result: string;
  };
  /** Writes every held row, then drains the open cursor uncapped, to `path` (decision 025). */
  "result.export": {
    params: {
      readonly handle: string;
      readonly extractor: ExtractorKind;
      readonly path: string;
      readonly columns: readonly number[];
    };
    result: ExportedResult;
  };
  /**
   * The datasource's namespaces, from the engine's cache unless `refresh`; the first call opens the
   * engine's introspection session (decision 022). Needs `schemaTree`.
   */
  "catalog.namespaces": { params: { readonly refresh?: boolean }; result: readonly Namespace[] };
  /** One namespace's objects, from the engine's cache unless `refresh`. Needs `schemaTree`. */
  "catalog.describe": {
    params: { readonly path: readonly string[]; readonly refresh?: boolean };
    result: DescribedCatalog;
  };
  /** `name` inside `path`, quoted by the plugin (decision 008). Needs `schemaTree`. */
  "catalog.qualifiedName": { params: { readonly path: readonly string[]; readonly name: string }; result: string };
  /**
   * The statements that create relation `name`, read from the database on the introspection session
   * and never cached (decision 029). Fails with `definitionNotFound` when it is gone. Needs `ddl`.
   */
  "catalog.definition": { params: { readonly path: readonly string[]; readonly name: string }; result: string };
  /**
   * A statement over relation `name` from the cached catalog, written by the plugin's language;
   * `create` answers what `catalog.definition` does. Needs `sql`, and `ddl` for `create`.
   */
  "sql.generate": {
    params: { readonly path: readonly string[]; readonly name: string; readonly statement: GeneratorStatement };
    result: string;
  };
  /**
   * Opens `relation` in the table editor: `SELECT *` with the bars' clauses verbatim, run on the
   * session, plus its identity from the catalog cache (decision 026). Its result refuses local sort.
   */
  "table.query": {
    params: {
      readonly sessionId: string;
      readonly path: readonly string[];
      readonly relation: string;
      readonly where: string;
      readonly orderBy: string;
    } & ResultPaging;
    result: TableQuery;
  };
  /** `SELECT COUNT(*)` with the WHERE bar, on the engine's own session so the editor's cursor stays open. */
  "table.count": {
    params: { readonly path: readonly string[]; readonly relation: string; readonly where: string };
    result: number;
  };
  /**
   * A WHERE condition matching the values `rows` hold in `columns`, written with the plugin's literals,
   * for Filter by This Value and foreign-key navigation.
   */
  "table.condition": {
    params: {
      readonly handle: string;
      readonly rows: readonly number[];
      readonly columns: readonly ConditionColumn[];
    };
    result: string;
  };
  /**
   * What may be typed at `offset` in `text`, read from the catalog cache and never from a console's
   * session (decision 028). With `scope`, `text` is a clause body against that table. Needs `sql`.
   */
  "completion.complete": {
    params: { readonly text: string; readonly offset: number; readonly scope?: CompletionScope };
    result: CompletionResult;
  };
  /** Where the name at `offset` was declared; null when it names nothing known. Needs `sql`. */
  "navigation.resolve": { params: { readonly text: string; readonly offset: number }; result: Declaration | null };
  /** The ORDER BY bar's text for header-click sorting, names quoted by the plugin; empty for no terms. */
  "table.orderBy": { params: { readonly terms: readonly OrderTerm[] }; result: string };
  /** The statements `edits.submit` would run, in order, without running them. */
  "edits.preview": {
    params: { readonly handle: string; readonly edits: readonly RowEdit[] };
    result: readonly string[];
  };
  /**
   * Runs the edits in one transaction on the table's session; any statement that fails or touches
   * other than one row rolls everything back with `editRejected` (decision 026).
   */
  "edits.submit": {
    params: { readonly sessionId: string; readonly handle: string; readonly edits: readonly RowEdit[] };
    result: SubmittedEdits;
  };
}

export type EngineMethod = keyof EngineCalls;

export type RequestOf<M extends EngineMethod> = { readonly id: number; readonly type: M } & EngineCalls[M]["params"];
export type EngineRequest = { [M in EngineMethod]: RequestOf<M> }[EngineMethod];

export type ResultOf<M extends EngineMethod> = EngineCalls[M]["result"];
export interface EngineResult<M extends EngineMethod = EngineMethod> {
  readonly id: number;
  readonly type: M;
  readonly result: ResultOf<M>;
}

/** Core's codes, plus the ones only the engine can raise. */
export type EngineErrorCode =
  | "unknownHandle"
  | "unknownPlugin"
  | "pluginUnavailable"
  | "invalidConfig"
  | "unknownSession"
  | "connectionFailed"
  | "statementFailed"
  | "cancelled"
  | "introspectionFailed"
  | "definitionNotFound"
  | "explainUnsupported"
  | "formatFailed"
  | "invalidRequest"
  | "editRejected"
  | "timedOut"
  | "internal";

export interface EngineError {
  readonly code: EngineErrorCode;
  readonly message: string;
  /** What the user can do next. */
  readonly hint: string;
  /** For `editRejected`: the 0-based index of the statement that failed or touched the wrong rows. */
  readonly statementIndex?: number;
}

export interface EngineErrorMessage {
  /** The request that failed, or `null` when the request was unreadable. */
  readonly id: number | null;
  readonly type: "engine.error";
  readonly error: EngineError;
}

export type EngineResponse = { [M in EngineMethod]: EngineResult<M> }[EngineMethod] | EngineErrorMessage;
