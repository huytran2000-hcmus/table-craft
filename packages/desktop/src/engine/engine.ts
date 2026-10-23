import { isAbsolute } from "node:path";
import {
  CatalogCache,
  completionCatalog,
  CoreError,
  EditRejectedError,
  editableIdentity,
  generateEdits,
  loadedPlugin,
  matchCondition,
  openSession,
  orderClause,
  project,
  ResultStore,
  rowWriter,
  submitEdits,
  tableCount,
  tableSelect,
  type EditTable,
  type ExportEncoderOptions,
  type PluginLoadResult,
  type ResultState,
  type RowEdit,
} from "@table-craft/core";
import {
  isPluginError,
  type BoundStatement,
  type Capability,
  type Column,
  type ColumnMeta,
  type CompletionCatalog,
  type ConnectOptions,
  type CompletionRequest,
  type CompletionResult,
  type Declaration,
  type Relation,
  type ResolveRequest,
  type Row,
  type Session,
  type SqlLanguage,
  type Transactions,
  type WireValue,
} from "@table-craft/plugin-api";
import type {
  ClassifiedStatement,
  ConditionColumn,
  CurrentNamespace,
  DatasourceConfig,
  EngineError,
  EngineMethod,
  EngineResponse,
  ExecutedStatement,
  Explainability,
  ExplainedStatement,
  EngineEvent,
  ExportFormat,
  ExportSource,
  ExportTask,
  FormatOptions,
  GeneratorStatement,
  ParameterValue,
  ProbeResult,
  Reconnection,
  ReferencingKey,
  RequestOf,
  ResultOf,
  ResultPaging,
  RowRange,
  TableQuery,
  TransactionState,
} from "@table-craft/desktop/engine/protocol.js";
import {
  connectionTarget,
  logResponse,
  type LoggedRequest,
  type RequestContext,
} from "@table-craft/desktop/engine/requestLog.js";
import { exportTasks, type ExportJob, type ExportRows } from "@table-craft/desktop/engine/exports.js";
import { engineRequestSchema, readRequestId } from "@table-craft/desktop/engine/requests.js";
import { SessionLost, StatementTimedOut, watchStatement, type LostReason } from "@table-craft/desktop/engine/watch.js";
import type { Logger, LogFields } from "@table-craft/desktop/log/record.js";

const SESSION_PREFIX = "session-";
const BUG_HINT = "This is a TableCraft bug; restart the app and report it.";

export interface EngineOptions {
  readonly datasource: DatasourceConfig;
  readonly plugins: readonly PluginLoadResult[];
  /** Where request records go (plan 017); silent when absent, as in most tests. */
  readonly log?: Logger;
}

/** One renderer port's view of the engine. Its sessions and results die with it. */
export interface EngineConnection {
  handle(message: unknown): Promise<EngineResponse>;
  close(): Promise<void>;
}

export interface Engine {
  /** `emit` receives every export event, whichever connection started the task (decision 040). */
  connect(emit?: (event: EngineEvent) => void): EngineConnection;
  /** Resolves once no export runs, so a reloading window does not cut one short. */
  exportsSettled(): Promise<void>;
  /** Closes what the engine holds for every connection: export tasks and the introspection session. */
  close(): Promise<void>;
}

class EngineFailure extends Error {
  constructor(
    readonly error: EngineError,
    cause?: unknown,
  ) {
    super(error.message, cause === undefined ? undefined : { cause });
  }
}

function toEngineError(cause: unknown): EngineError {
  if (cause instanceof EngineFailure) return cause.error;
  if (cause instanceof EditRejectedError) {
    return { code: cause.code, message: cause.message, hint: cause.hint, statementIndex: cause.statementIndex };
  }
  if (cause instanceof CoreError) return { code: cause.code, message: cause.message, hint: cause.hint };
  const message = cause instanceof Error ? cause.message : String(cause);
  return { code: "internal", message, hint: BUG_HINT };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function connectionFailed(cause: unknown): unknown {
  if (!isPluginError(cause) || cause.code !== "connectionFailed") return cause;
  return new EngineFailure(
    {
      code: "connectionFailed",
      message: `Could not connect: ${cause.message}`,
      hint: "Check that the database is running and that the host, port, user and password are right.",
    },
    cause,
  );
}

const STATEMENT_HINT = "Fix the statement and run it again.";
const FORMAT_HINT = "The text is unchanged; fix what the reason points at and reformat again.";
const READ_ONLY_STATEMENT_HINT =
  "This data source is read-only, so writes are refused; clear Read-only in its properties to write.";

const RECONNECT_HINT = "Run it again; the console reconnects first.";
const UNKNOWN_OUTCOME_HINT = "Run it again to reconnect, but check first whether it took effect.";

function statementFailed(cause: unknown, readOnly: boolean): EngineFailure {
  if (cause instanceof EngineFailure) return cause;
  if (isPluginError(cause) && cause.code === "connectionLost") {
    return new EngineFailure({ code: "connectionLost", message: cause.message, hint: RECONNECT_HINT }, cause);
  }
  if (isPluginError(cause) && cause.code === "cancelled") {
    return new EngineFailure({
      code: "cancelled",
      message: "The statement was cancelled.",
      hint: "Run it again when ready.",
    });
  }
  return new EngineFailure(
    { code: "statementFailed", message: messageOf(cause), hint: readOnly ? READ_ONLY_STATEMENT_HINT : STATEMENT_HINT },
    cause,
  );
}

function explainFailed(cause: unknown, readOnly: boolean): EngineFailure {
  if (isPluginError(cause) && cause.code === "explainUnsupported") {
    return new EngineFailure({
      code: "explainUnsupported",
      message: cause.message,
      hint: "Put the caret in a statement this database can explain.",
    });
  }
  return statementFailed(cause, readOnly);
}

function explainabilityOf(language: SqlLanguage, sql: string, analyze: boolean): Explainability {
  if (language.explainable === undefined) {
    throw new EngineFailure({
      code: "invalidRequest",
      message: "This datasource's plugin does not declare the explain capability.",
      hint: BUG_HINT,
    });
  }
  return language.explainable(sql, { analyze });
}

const INTROSPECTION_HINT = "Check that this user may read the schema, then choose Synchronize (⌥⌘Y) to try again.";

const DEFINITION_HINT = "Choose Synchronize (⌥⌘Y) to see what the namespace holds now.";

function introspectionFailed(cause: unknown): unknown {
  if (!isPluginError(cause)) return cause;
  if (cause.code === "definitionNotFound") {
    return new EngineFailure({ code: "definitionNotFound", message: cause.message, hint: DEFINITION_HINT });
  }
  if (cause.code !== "introspectionFailed") return cause;
  return new EngineFailure({ code: "introspectionFailed", message: cause.message, hint: INTROSPECTION_HINT });
}

interface Introspection {
  readonly session: Session;
  readonly cache: CatalogCache;
}

interface OpenSession {
  /** Replaced, under the same session id, when the engine reconnects (decision 054). */
  session: Session;
  readonly capabilities: readonly Capability[];
  /** Statements in flight: `statement.execute` calls that have not answered yet. */
  running: number;
  /** Where the session started, as `currentNamespace` read it; undefined when it could not say. */
  opening: CurrentNamespace | undefined;
  /** When the session last finished a statement, for the idle ping. */
  lastUsed: number;
  /** Why the session was given up, so the next statement reconnects; null while it is usable. */
  lost: string | null;
  /**
   * Whether a statement may have moved the session off `opening` (decision 048). Its reads then
   * resolve names a fresh session would resolve elsewhere, so an export must not re-run them.
   */
  moved: boolean;
}

function samePath(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((part, index) => part === b[index]);
}

const MS_PER_SECOND = 1_000;

/** Every connection the engine opens asks for TCP keepalive at the data source's interval (decision 054). */
function connectOptions(datasource: DatasourceConfig, readOnly: boolean): ConnectOptions {
  const { keepAliveSeconds } = datasource;
  return keepAliveSeconds > 0 ? { readOnly, keepAliveInitialDelayMs: keepAliveSeconds * MS_PER_SECOND } : { readOnly };
}

function connectDatasource(options: EngineOptions, readOnly = options.datasource.readOnly): Promise<Session> {
  const { datasource } = options;
  return openSession(
    options.plugins,
    datasource.pluginId,
    datasource.config,
    connectOptions(datasource, readOnly),
  ).catch((cause: unknown) => {
    throw connectionFailed(cause);
  });
}

/**
 * Test Connection (plan 004): connect once, read what the server reports, close. Never rejects;
 * a failure comes back as the error the console would have shown.
 */
export async function probeDatasource(options: EngineOptions, now: () => number = Date.now): Promise<ProbeResult> {
  const started = now();
  try {
    const session = await connectDatasource(options);
    const elapsedMs = now() - started;
    await session.close().catch(() => undefined);
    const { manifest } = loadedPlugin(options.plugins, options.datasource.pluginId);
    return { ok: true, pluginName: manifest.name, serverVersion: session.serverVersion, elapsedMs };
  } catch (cause) {
    return { ok: false, error: toEngineError(cause) };
  }
}

const TRANSACTION_HINT = "Check the connection, then try again; the transaction may already have ended.";

/** How long an idle session's ping may take before the engine reconnects instead (decision 054). */
const PING_TIMEOUT_MS = 5_000;
/** How long a timed-out statement may take to end once cancelled before its session is dropped. */
const CANCEL_GRACE_MS = 5_000;
/**
 * How long a probe connection may stay silent while a statement runs. A reachable server accepts
 * or refuses within milliseconds; TCP keepalive alone cannot tell, because a hop that answers TCP
 * itself (Docker Desktop, an SSH tunnel) keeps the statement's socket looking alive.
 */
const PROBE_WINDOW_MS = 5_000;

const LOST_REASONS: Readonly<Record<LostReason, string>> = {
  cancelUnanswered: "cancel unanswered",
  serverUnreachable: "server unreachable",
};

function transactionLost(): EngineFailure {
  return new EngineFailure({
    code: "connectionLost",
    message: "The connection was lost with a transaction open; its uncommitted changes are gone.",
    hint: "Run again to reconnect, then repeat the transaction's statements.",
  });
}

function lostInFlight(cause: SessionLost, timeoutSeconds: number): EngineFailure {
  const message =
    cause.reason === "cancelUnanswered"
      ? `The statement timed out after ${String(timeoutSeconds)} s and the server did not answer the cancel, so the connection was dropped.`
      : "The connection was lost while the statement ran; it may have completed on the server.";
  return new EngineFailure({ code: "connectionLost", message, hint: UNKNOWN_OUTCOME_HINT }, cause);
}

function timedOut(seconds: number): EngineFailure {
  return new EngineFailure({
    code: "statementTimedOut",
    message: `The statement timed out after ${String(seconds)} s and was cancelled.`,
    hint: "Raise the statement timeout in the data source's Advanced settings, or in Settings → Editor → Running.",
  });
}

/** Null when `session` answered its ping in time; else why it counts as lost. */
async function pingFailure(session: Session): Promise<string | null> {
  if (session.ping === undefined) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const silence = new Promise<string>((resolve) => {
    timer = setTimeout(() => {
      resolve("ping timed out");
    }, PING_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      session.ping().then(
        () => null,
        () => "ping failed",
      ),
      silence,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
/**
 * Closing a cursor waits for the server to answer, which a dead or silent link never does; past this
 * the sessions close anyway, and their bounded close tears the sockets down (decision 040).
 */
const RELEASE_GRACE_MS = 3_000;

function settledWithin(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    void work.finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function* heldThenRest(held: readonly Row[], rest: AsyncIterable<Row>): AsyncGenerator<Row> {
  yield* held;
  yield* rest;
}

async function* heldRows(held: readonly Row[]): AsyncGenerator<Row> {
  await Promise.resolve();
  yield* held;
}

function rowsIn(rows: readonly Row[], ranges: readonly RowRange[]): Row[] {
  return ranges.flatMap((range) => rows.slice(range.from, Math.max(range.from, range.to)));
}
const OPEN_TRANSACTION_HINT = "Commit or roll back the open transaction first.";
const SYNCHRONIZE_HINT = "Choose Synchronize (⌥⌘Y), then open the table again.";
const EMPTY_COMPLETION_CATALOG: CompletionCatalog = {
  current: null,
  namespaces: () => Promise.resolve([]),
  relations: () => Promise.resolve([]),
  referencing: () => Promise.resolve([]),
};

const STALE_CATALOG_REASON = "The table's columns differ from the cached catalog; synchronize to edit it.";
const SERVER_SORT_HINT = "Sort a table editor on the server: click the column header or edit ORDER BY.";

/** What the engine remembers about a `table.query` result so edits and conditions can be written. */
interface TableResult extends EditTable {
  /** Why the table cannot be edited, or null when it can (decision 026). */
  readonly readOnly: string | null;
}

/** A result column the catalog does not know, described from what the driver reported. */
function reportedColumn(column: Column, index: number): ColumnMeta {
  return {
    name: column.name,
    position: index + 1,
    type: column.type ?? "",
    nullable: true,
    default: null,
    comment: null,
    autoIncrement: false,
  };
}

/** COUNT(*) comes back as a number, a decimal string or a bigint, by driver. */
function countOf(value: WireValue | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (typeof value === "object" && value !== null && value.kind === "bigint") return Number(value.value);
  throw new EngineFailure({ code: "internal", message: "COUNT(*) returned no number.", hint: BUG_HINT });
}

export function createEngine(options: EngineOptions, now: () => number = Date.now): Engine {
  const log = options.log ?? null;
  const sessionLog = log?.child("session") ?? null;
  let target: LogFields | null = null;

  /** Classified for the record only; a plugin that cannot classify leaves the kind unknown. */
  function statementKind(request: LoggedRequest): string | null {
    if (typeof request.sql !== "string") return null;
    try {
      return sqlLanguage().classify(request.sql).kind;
    } catch {
      return null;
    }
  }

  function logContext(request: LoggedRequest, started: number): RequestContext {
    const manifest = options.plugins.find((entry) => entry.manifest?.id === options.datasource.pluginId)?.manifest;
    target ??= connectionTarget(manifest?.connection.fields ?? [], options.datasource.config);
    return {
      log: log as Logger,
      elapsedMs: now() - started,
      statementKind: statementKind(request),
      target: { pluginId: options.datasource.pluginId, ...target },
    };
  }

  function sqlLanguage(): SqlLanguage {
    const { language } = loadedPlugin(options.plugins, options.datasource.pluginId).plugin;
    if (language === undefined) {
      throw new EngineFailure({
        code: "invalidRequest",
        message: "This datasource's plugin does not declare the sql capability.",
        hint: BUG_HINT,
      });
    }
    return language;
  }

  function splitScript(text: string): ClassifiedStatement[] {
    const language = sqlLanguage();
    return language.split(text).map((span) => {
      const { kind, destructive } = language.classify(span.sql);
      return { ...span, kind, destructive, parameters: language.parameters(span.sql) };
    });
  }

  function formatText(text: string, format: FormatOptions): string {
    try {
      return sqlLanguage().format(text, format);
    } catch (cause) {
      if (cause instanceof EngineFailure) throw cause;
      throw new EngineFailure({ code: "formatFailed", message: messageOf(cause), hint: FORMAT_HINT });
    }
  }

  const results = new ResultStore();
  let nextSession = 1;
  /** One session for every connection's catalog calls, opened on first use (decision 022). */
  let introspection: Promise<Introspection> | null = null;

  async function openIntrospection(): Promise<Introspection> {
    const session = await connectDatasource(options);
    if (session.introspector === undefined) {
      await session.close().catch(() => undefined);
      throw new EngineFailure({
        code: "invalidRequest",
        message: "This datasource's plugin does not declare the schemaTree capability.",
        hint: BUG_HINT,
      });
    }
    return { session, cache: new CatalogCache(session.introspector) };
  }

  /** A failed open is forgotten, so the next catalog call connects again. */
  function catalog(): Promise<Introspection> {
    if (introspection === null) {
      const opening = openIntrospection();
      introspection = opening;
      opening.catch(() => {
        if (introspection === opening) introspection = null;
      });
    }
    return introspection;
  }

  async function introspect<T>(read: (open: Introspection) => Promise<T> | T): Promise<T> {
    const open = await catalog();
    try {
      return await read(open);
    } catch (cause) {
      throw introspectionFailed(cause);
    }
  }

  /** `name` in `path` from the catalog cache, described afresh once when the cache lacks it. */
  function relationOf(path: readonly string[], name: string): Promise<{ relation: Relation; qualified: string }> {
    return introspect(async ({ cache, session }) => {
      const find = (described: { readonly catalog: { readonly relations: readonly Relation[] } }) =>
        described.catalog.relations.find((relation) => relation.name === name);
      const relation = find(await cache.describe(path)) ?? find(await cache.describe(path, true));
      if (relation === undefined) {
        throw new EngineFailure({
          code: "invalidRequest",
          message: `There is no table ${name} in ${path.join(".")}.`,
          hint: SYNCHRONIZE_HINT,
        });
      }
      return { relation, qualified: session.introspector?.qualifiedName(path, name) ?? name };
    });
  }

  /** Read afresh on every call, never from the cache (decision 029). */
  function definitionOf(path: readonly string[], name: string): Promise<string> {
    const { plugin } = loadedPlugin(options.plugins, options.datasource.pluginId);
    if (!plugin.capabilities.includes("ddl")) {
      throw new EngineFailure({
        code: "invalidRequest",
        message: "This datasource's plugin does not declare the ddl capability.",
        hint: BUG_HINT,
      });
    }
    return introspect(async ({ session }) => {
      const introspector = session.introspector;
      if (introspector?.definition === undefined) {
        throw new EngineFailure({
          code: "invalidRequest",
          message: "This datasource's plugin declares ddl but its introspector has no definition.",
          hint: BUG_HINT,
        });
      }
      return introspector.definition(path, name);
    });
  }

  async function generate(path: readonly string[], name: string, statement: GeneratorStatement): Promise<string> {
    if (statement === "create") return definitionOf(path, name);
    const language = sqlLanguage();
    const { relation, qualified } = await relationOf(path, name);
    return language.generate(statement, relation, qualified);
  }

  /** Foreign keys in every described namespace that target `path`.`name`. */
  function referencingKeys(path: readonly string[], name: string): Promise<ReferencingKey[]> {
    const target = JSON.stringify(path);
    return introspect(({ cache }) =>
      cache
        .described()
        .flatMap(({ catalog: described }) =>
          described.relations.flatMap((relation) =>
            relation.foreignKeys
              .filter((key) => key.target.relation === name && JSON.stringify(key.target.path) === target)
              .map((foreignKey) => ({ path: described.path, relation: relation.name, foreignKey })),
          ),
        ),
    );
  }

  /**
   * Completion and navigation read the catalog cache through the introspection session, never a
   * console's (decision 028). When that session cannot open they answer from no catalog at all.
   */
  async function completionCatalogOf(current: readonly string[] | undefined): Promise<CompletionCatalog> {
    const open = await catalog().catch(() => null);
    if (open === null)
      return current === undefined ? EMPTY_COMPLETION_CATALOG : { ...EMPTY_COMPLETION_CATALOG, current };
    return completionCatalog(open.cache, current === undefined ? {} : { current });
  }

  function checkedOffset(text: string, offset: number): void {
    if (offset > text.length) {
      throw new EngineFailure({
        code: "invalidRequest",
        message: `The caret offset ${offset} is past the end of the ${text.length}-character text.`,
        hint: BUG_HINT,
      });
    }
  }

  async function complete(request: CompletionRequest, current?: readonly string[]): Promise<CompletionResult> {
    checkedOffset(request.text, request.offset);
    const language = sqlLanguage();
    return language.complete(request, await completionCatalogOf(current));
  }

  async function resolve(request: ResolveRequest, current?: readonly string[]): Promise<Declaration | null> {
    checkedOffset(request.text, request.offset);
    const language = sqlLanguage();
    return language.resolve(request, await completionCatalogOf(current));
  }

  const tasks = exportTasks(log === null ? {} : { log: log.child("export") });

  /** An export's rows from `sql` on a read-only session of its own, every byte of binary values in full. */
  async function exportRowsOf(sql: string): Promise<ExportRows> {
    const session = await connectDatasource(options, true);
    try {
      const result = await session.execute(sql, [], { fullBytes: true });
      return { rows: result.rows, close: () => session.close() };
    } catch (cause) {
      await session.close().catch(() => undefined);
      throw statementFailed(cause, true);
    }
  }

  async function tableJob(
    source: Extract<ExportSource, { kind: "table" }>,
    format: ExportFormat,
    path: string,
  ): Promise<ExportJob> {
    const language = sqlLanguage();
    const { relation, qualified } = await relationOf(source.path, source.relation);
    const columns = source.columns.map((name): Column => {
      const meta = relation.columns.find((column) => column.name === name);
      if (meta === undefined) {
        throw new EngineFailure({
          code: "invalidRequest",
          message: `There is no column ${name} in ${source.relation}.`,
          hint: SYNCHRONIZE_HINT,
        });
      }
      return { name: meta.name, type: meta.type };
    });
    const list = columns.map((column) => language.quoteIdentifier(column.name)).join(", ");
    const sql = `SELECT ${list} FROM ${qualified}`;
    const encoder: ExportEncoderOptions = { dialect: language, table: qualified };
    return {
      path,
      format,
      origin: "table",
      columns,
      projection: null,
      estimate: null,
      encoder,
      retryable: true,
      drains: null,
      open: () => exportRowsOf(sql),
    };
  }

  function taskOf(taskId: string): ExportTask {
    const task = tasks.get(taskId);
    if (task === undefined) {
      throw new EngineFailure({
        code: "invalidRequest",
        message: `No export task "${taskId}".`,
        hint: "Export again.",
      });
    }
    return task;
  }

  function absolutePath(path: string): void {
    if (!isAbsolute(path)) {
      throw new EngineFailure({
        code: "invalidRequest",
        message: `Export needs an absolute path, not "${path}".`,
        hint: BUG_HINT,
      });
    }
  }

  /** Count Rows on a session of its own: the editor's session would close its open cursor. */
  async function countRows(path: readonly string[], name: string, where: string): Promise<number> {
    const { qualified } = await relationOf(path, name);
    const session = await connectDatasource(options);
    try {
      const result = await session.execute(tableCount(qualified, where));
      let first: Row | undefined;
      for await (const row of result.rows) first ??= row;
      return countOf(first?.[0]);
    } catch (cause) {
      throw cause instanceof EngineFailure ? cause : statementFailed(cause, options.datasource.readOnly);
    } finally {
      await session.close().catch(() => undefined);
    }
  }

  function connect(emit: (event: EngineEvent) => void = () => undefined): EngineConnection {
    const sessions = new Map<string, OpenSession>();
    /** Each live result handle, mapped to the session that produced it. */
    const handles = new Map<string, string>();
    /** The one result per session whose cursor is still open (decision 025). */
    const cursors = new Map<string, string>();
    /** The handles `table.query` produced, with what editing them needs. */
    const tables = new Map<string, TableResult>();
    /** The statement behind each handle, so an export can run it again on a session of its own. */
    const statements = new Map<string, string>();
    const unsubscribe = tasks.subscribe(emit);

    function forget(handle: string): void {
      handles.delete(handle);
      tables.delete(handle);
      statements.delete(handle);
    }

    async function releaseHandlesOf(sessionId: string): Promise<void> {
      cursors.delete(sessionId);
      const owned = [...handles].filter(([, owner]) => owner === sessionId).map(([handle]) => handle);
      for (const handle of owned) forget(handle);
      await Promise.all(owned.map((handle) => results.release(handle)));
    }

    /** Before the session runs anything else or its transaction ends, its open cursor closes. */
    async function closeCursorOf(sessionId: string): Promise<void> {
      const handle = cursors.get(sessionId);
      if (handle === undefined) return;
      cursors.delete(sessionId);
      await results.closeCursor(handle).catch(() => undefined);
    }

    function track(handle: string, state: ResultState): ResultState {
      const owner = handles.get(handle);
      if (owner !== undefined && !state.cursorOpen && cursors.get(owner) === handle) cursors.delete(owner);
      return state;
    }

    function chosenColumns(handle: string, indices: readonly number[]): Column[] {
      const all = results.columns(handle);
      return indices.map((index) => {
        const column = all[index];
        if (column === undefined) {
          throw new EngineFailure({
            code: "invalidRequest",
            message: `Column ${String(index)} is outside this result's ${String(all.length)} columns.`,
            hint: BUG_HINT,
          });
        }
        return column;
      });
    }

    /**
     * Where a result's export reads from (decision 040): its statement again on a session of the
     * export's own when it is a read that sees what any session sees; else the rows held when
     * the cursor is done; else the console's own cursor, drained.
     */
    function resultJob(
      source: { handle: string; columns: readonly number[] },
      format: ExportFormat,
      path: string,
    ): ExportJob {
      const handle = ownedHandle(source.handle);
      const language = sqlLanguage();
      const columns = chosenColumns(handle, source.columns);
      const owner = sessions.get(handles.get(handle) ?? "");
      const sql = statements.get(handle);
      const state = results.state(handle);
      const table = tables.get(handle)?.table;
      const base = {
        path,
        format,
        columns,
        projection: source.columns,
        encoder: table === undefined ? { dialect: language } : { dialect: language, table },
      };
      const rerun =
        sql !== undefined &&
        owner !== undefined &&
        language.classify(sql).kind === "read" &&
        owner.session.transactions?.open !== true &&
        owner.session.privateDatabase !== true;
      if (rerun) {
        return {
          ...base,
          origin: "rerun",
          estimate: state.cursorOpen ? null : state.rowCount,
          retryable: true,
          drains: null,
          open: () => exportRowsOf(sql),
        };
      }
      const held = results.rows(handle);
      if (!state.cursorOpen) {
        return {
          ...base,
          origin: "memory",
          estimate: held.length,
          retryable: false,
          drains: null,
          open: () => Promise.resolve({ rows: heldRows(held), close: () => Promise.resolve() }),
        };
      }
      const sessionId = handles.get(handle);
      if (sessionId !== undefined && cursors.get(sessionId) === handle) cursors.delete(sessionId);
      return {
        ...base,
        origin: "cursor",
        estimate: null,
        retryable: false,
        drains: handle,
        open: () => drainCursor(handle, held),
      };
    }

    /** The console's cursor, handed to the export until it closes its rows. */
    function drainCursor(handle: string, held: readonly Row[]): Promise<ExportRows> {
      return new Promise((resolve, reject) => {
        let finish = (): void => undefined;
        const finished = new Promise<void>((settle) => {
          finish = settle;
        });
        const draining = results.drain(handle, (rest) => {
          resolve({
            rows: heldThenRest(held, rest),
            close: () => {
              finish();
              return draining.then(
                () => undefined,
                () => undefined,
              );
            },
          });
          return finished;
        });
        draining.catch(reject);
      });
    }

    function sessionFor(sessionId: string): OpenSession {
      const session = sessions.get(sessionId);
      if (session === undefined) {
        throw new EngineFailure({
          code: "unknownSession",
          message: `No open session "${sessionId}".`,
          hint: "Open a new session and run the statement again.",
        });
      }
      return session;
    }

    /**
     * What the session reports as its namespace now (decision 048), or undefined when the plugin
     * cannot say or the read fails: the console then keeps what it had.
     */
    async function namespaceOf(
      open: Pick<OpenSession, "session" | "capabilities">,
    ): Promise<CurrentNamespace | undefined> {
      if (!open.capabilities.includes("currentNamespace") || open.session.currentNamespace === undefined) {
        return undefined;
      }
      return open.session.currentNamespace().catch(() => undefined);
    }

    /** Notes whether `open` is off its opening namespace; a switch it could not read counts as one. */
    function noteNamespace(open: OpenSession, namespace: CurrentNamespace | undefined, switched: boolean): void {
      if (namespace !== undefined && open.opening !== undefined) open.moved = !samePath(namespace, open.opening);
      else if (switched) open.moved = true;
    }

    function ownedHandle(handle: string): string {
      if (!handles.has(handle)) {
        throw new CoreError(
          "unknownHandle",
          `No result with handle "${handle}" on this connection.`,
          "Run the statement again.",
        );
      }
      return handle;
    }

    const keepAliveMs = options.datasource.keepAliveSeconds * MS_PER_SECOND;

    function pings(open: OpenSession): boolean {
      return keepAliveMs > 0 && open.capabilities.includes("keepAlive") && open.session.ping !== undefined;
    }

    /** Whether the session must prove itself before a statement: given up, or idle a keepalive interval. */
    function needsCheck(open: OpenSession): boolean {
      return open.lost !== null || (pings(open) && now() - open.lastUsed >= keepAliveMs);
    }

    /**
     * Gives the session up: its socket is torn down (the plugins' close is bounded) and the next
     * statement reconnects. A transaction open on it is gone, which the caller must say rather
     * than heal silently.
     */
    function abandon(sessionId: string, open: OpenSession, reason: string): { transaction: boolean } {
      const transaction = open.session.transactions?.open === true;
      open.lost = reason;
      sessionLog?.warn("session lost", { reason, transaction });
      void closeCursorOf(sessionId);
      void open.session.close().catch(() => undefined);
      return { transaction };
    }

    /** A fresh session in place of the lost one, in the same transaction mode; its namespace is read afresh. */
    async function reconnect(sessionId: string, open: OpenSession): Promise<Reconnection> {
      const mode = open.session.transactions?.mode;
      const session = await connectDatasource(options);
      try {
        if (mode === "manual") await session.transactions?.setMode("manual");
      } catch (cause) {
        await session.close().catch(() => undefined);
        throw new EngineFailure({ code: "connectionFailed", message: messageOf(cause), hint: RECONNECT_HINT }, cause);
      }
      const namespace = await namespaceOf({ session, capabilities: open.capabilities });
      if (sessions.get(sessionId) !== open) {
        await session.close().catch(() => undefined);
        sessionFor(sessionId);
      }
      const namespaceLost = open.moved;
      open.session = session;
      open.opening = namespace;
      open.moved = false;
      open.lost = null;
      open.lastUsed = now();
      sessionLog?.info("session reconnected", { namespaceLost });
      return { namespace: namespace ?? null, namespaceLost };
    }

    /** Pings an idle session and reconnects a lost one; undefined when the session was fine. */
    async function ensureLive(sessionId: string, open: OpenSession): Promise<Reconnection | undefined> {
      if (open.lost === null) {
        const reason = await pingFailure(open.session);
        if (reason === null) {
          open.lastUsed = now();
          return undefined;
        }
        if (abandon(sessionId, open, reason).transaction) throw transactionLost();
      }
      return reconnect(sessionId, open);
    }

    function probeServer(): Promise<void> {
      return connectDatasource(options, true).then((session) => {
        void session.close().catch(() => undefined);
      });
    }

    /** `work` on `open`'s session under the statement timeout and, while it runs, the liveness probe. */
    async function watched<T>(
      sessionId: string,
      open: OpenSession,
      work: Promise<T>,
      timeoutSeconds: number,
      discard: (late: T) => void,
    ): Promise<T> {
      const { session } = open;
      const cancel =
        open.capabilities.includes("cancel") && session.cancel !== undefined
          ? () => session.cancel?.() ?? Promise.resolve()
          : undefined;
      const probing = keepAliveMs > 0 && open.capabilities.includes("keepAlive");
      try {
        return await watchStatement(work, {
          timeoutSeconds,
          ...(cancel === undefined ? {} : { cancel }),
          graceMs: CANCEL_GRACE_MS,
          probeEveryMs: probing ? keepAliveMs : 0,
          ...(probing ? { probe: probeServer } : {}),
          probeWindowMs: PROBE_WINDOW_MS,
        });
      } catch (cause) {
        if (cause instanceof StatementTimedOut) {
          sessionLog?.info("statement timed out", { seconds: timeoutSeconds });
          throw timedOut(timeoutSeconds);
        }
        if (cause instanceof SessionLost) {
          work.then(discard, () => undefined);
          const lost = open.session === session && open.lost === null;
          const transaction = lost && abandon(sessionId, open, LOST_REASONS[cause.reason]).transaction;
          throw transaction ? transactionLost() : lostInFlight(cause, timeoutSeconds);
        }
        throw cause;
      }
    }

    /**
     * Runs `run` on a session known to be alive: an idle one is pinged first, a lost one replaced,
     * and a statement the plugin refused because the connection was already gone runs once more
     * on a fresh session, since it never reached the server.
     */
    async function onLiveSession<T>(
      sessionId: string,
      open: OpenSession,
      timeoutSeconds: number,
      run: (session: Session) => Promise<T>,
      failed: (cause: unknown) => EngineFailure,
      discard: (late: T) => void = () => undefined,
    ): Promise<{ value: T; reconnected: Reconnection | undefined }> {
      // Awaited only when there is one: a needless await would let a cancel overtake the execute.
      if (cursors.has(sessionId)) await closeCursorOf(sessionId);
      let reconnected = needsCheck(open) ? await ensureLive(sessionId, open) : undefined;
      try {
        return { value: await watched(sessionId, open, run(open.session), timeoutSeconds, discard), reconnected };
      } catch (cause) {
        if (reconnected !== undefined || !isPluginError(cause) || cause.code !== "connectionLost") throw failed(cause);
      }
      if (abandon(sessionId, open, "driver reported").transaction) throw transactionLost();
      reconnected = await reconnect(sessionId, open);
      try {
        return { value: await watched(sessionId, open, run(open.session), timeoutSeconds, discard), reconnected };
      } catch (cause) {
        throw failed(cause);
      }
    }

    async function runStatement(
      sessionId: string,
      sql: string,
      parameters: Readonly<Record<string, ParameterValue>> | undefined,
      paging: ResultPaging,
      timeoutSeconds: number,
    ): Promise<ExecutedStatement> {
      const open = sessionFor(sessionId);
      let bound: BoundStatement = { sql, params: [] };
      try {
        if (parameters !== undefined) bound = sqlLanguage().bind(sql, parameters);
      } catch (cause) {
        throw statementFailed(cause, options.datasource.readOnly);
      }
      open.running += 1;
      try {
        const { value: summary, reconnected } = await onLiveSession(
          sessionId,
          open,
          timeoutSeconds,
          (session) => session.execute(bound.sql, bound.params).then((result) => results.put(result, paging)),
          (cause) => statementFailed(cause, options.datasource.readOnly),
          (late) => void results.release(late.handle),
        );
        if (sessions.get(sessionId) !== open) {
          // The session closed while the statement ran; nobody is left to release this result.
          await results.release(summary.handle);
          sessionFor(sessionId);
        }
        handles.set(summary.handle, sessionId);
        if (!open.moved) statements.set(summary.handle, sql);
        if (summary.cursorOpen) cursors.set(sessionId, summary.handle);
        // An open cursor keeps the session busy, and no statement that switches returns rows.
        // A statement that switches namespaces, or ends a transaction that may have, is followed by a read.
        const statement = sqlLanguage().classify(bound.sql);
        const switches = statement.setsNamespace === true;
        const moves = !summary.cursorOpen && (switches || statement.kind === "transaction");
        const namespace = moves ? await namespaceOf(open) : undefined;
        if (moves) noteNamespace(open, namespace, switches);
        return {
          ...summary,
          firstWindow: results.window(summary.handle, 0),
          transactionOpen: open.session.transactions?.open ?? false,
          ...(namespace === undefined ? {} : { namespace }),
          ...(reconnected === undefined ? {} : { reconnected }),
        };
      } finally {
        open.running -= 1;
        open.lastUsed = now();
      }
    }

    async function explainStatement(request: RequestOf<"statement.explain">): Promise<ExplainedStatement> {
      const open = sessionFor(request.sessionId);
      const needed: Capability = request.analyze ? "explainAnalyze" : "explain";
      if (!open.capabilities.includes(needed) || open.session.explain === undefined) {
        throw new EngineFailure({
          code: "invalidRequest",
          message: `This datasource's plugin does not declare the ${needed} capability.`,
          hint: BUG_HINT,
        });
      }
      open.running += 1;
      try {
        const { value: plan, reconnected } = await onLiveSession(
          request.sessionId,
          open,
          request.timeoutSeconds ?? 0,
          (session) => {
            if (session.explain === undefined) throw new Error("The session lost its explain method.");
            return session.explain(request.sql, { analyze: request.analyze });
          },
          (cause) => explainFailed(cause, options.datasource.readOnly),
        );
        sessionFor(request.sessionId);
        return {
          plan,
          transactionOpen: open.session.transactions?.open ?? false,
          ...(reconnected === undefined ? {} : { reconnected }),
        };
      } finally {
        open.running -= 1;
        open.lastUsed = now();
      }
    }

    async function queryTable(request: RequestOf<"table.query">): Promise<TableQuery> {
      const open = sessionFor(request.sessionId);
      const { relation, qualified } = await relationOf(request.path, request.relation);
      const sql = tableSelect(qualified, request);
      const statement = await runStatement(request.sessionId, sql, undefined, request, request.timeoutSeconds ?? 0);
      const catalogued = statement.columns.map((column) => relation.columns.find((meta) => meta.name === column.name));
      const columns = catalogued.map(
        (meta, index) => meta ?? reportedColumn(statement.columns[index] ?? { name: "", type: null }, index),
      );
      const stale = statement.columns.length !== relation.columns.length || catalogued.includes(undefined);
      const resolved = editableIdentity(relation, options.datasource.readOnly, open.capabilities);
      const editable = "identity" in resolved && stale ? { readOnly: STALE_CATALOG_REASON } : resolved;
      tables.set(statement.handle, {
        table: qualified,
        columns: columns.map((meta) => ({ name: meta.name, type: meta.type, default: meta.default })),
        identity:
          "identity" in editable
            ? editable.identity.map((name) => columns.findIndex((meta) => meta.name === name))
            : [],
        readOnly: "readOnly" in editable ? editable.readOnly : null,
      });
      const referencing = await referencingKeys(request.path, request.relation);
      return { statement, sql, editable, columns, foreignKeys: relation.foreignKeys, referencing };
    }

    function tableFor(handle: string): TableResult {
      const table = tables.get(ownedHandle(handle));
      if (table === undefined) {
        throw new EngineFailure({
          code: "invalidRequest",
          message: "That result did not come from the table editor.",
          hint: BUG_HINT,
        });
      }
      return table;
    }

    function editStatements(handle: string, edits: readonly RowEdit[]): string[] {
      const table = tableFor(handle);
      if (table.readOnly !== null) {
        throw new EngineFailure({
          code: "invalidRequest",
          message: table.readOnly,
          hint: "Edit it with statements in a console.",
        });
      }
      const held = results.rows(handle);
      return generateEdits({ ...table, rows: (row) => held[row], edits, language: sqlLanguage() });
    }

    async function submit(request: RequestOf<"edits.submit">) {
      const open = sessionFor(request.sessionId);
      if (handles.get(request.handle) !== request.sessionId) {
        throw new EngineFailure({
          code: "invalidRequest",
          message: "That table result belongs to another session.",
          hint: BUG_HINT,
        });
      }
      const statements = editStatements(request.handle, request.edits);
      await closeCursorOf(request.sessionId);
      return submitEdits(open.session, statements);
    }

    function condition(handle: string, rows: readonly number[], columns: readonly ConditionColumn[]): string {
      const held = results.rows(ownedHandle(handle));
      const table = tables.get(handle);
      const reported = results.columns(handle);
      const typed = columns.map(({ column, name }) => ({
        name,
        type: table?.columns[column]?.type ?? reported[column]?.type ?? null,
      }));
      const tuples = rows.map((index) => {
        const row = held[index];
        if (row === undefined) {
          throw new EngineFailure({
            code: "invalidRequest",
            message: `Row ${String(index + 1)} is not held by this result.`,
            hint: "Reload the table and choose the cell again.",
          });
        }
        return columns.map(({ column }) => row[column] ?? null);
      });
      return matchCondition(sqlLanguage(), typed, tuples);
    }

    async function transact(
      sessionId: string,
      change: (transactions: Transactions) => Promise<void>,
      hint: string,
    ): Promise<TransactionState> {
      const open = sessionFor(sessionId);
      const { transactions } = open.session;
      if (!open.capabilities.includes("transactions") || transactions === undefined) {
        throw new EngineFailure({
          code: "invalidRequest",
          message: "This datasource's plugin does not declare the transactions capability.",
          hint: BUG_HINT,
        });
      }
      if (open.lost !== null) await reconnect(sessionId, open);
      try {
        await closeCursorOf(sessionId);
        await change(open.session.transactions ?? transactions);
      } catch (cause) {
        throw new EngineFailure({ code: "statementFailed", message: messageOf(cause), hint }, cause);
      }
      const namespace = await namespaceOf(open);
      noteNamespace(open, namespace, false);
      return {
        mode: transactions.mode,
        transactionOpen: transactions.open,
        ...(namespace === undefined ? {} : { namespace }),
      };
    }

    const routes: { [M in EngineMethod]: (request: RequestOf<M>) => Promise<ResultOf<M>> } = {
      "session.open": async () => {
        const session = await connectDatasource(options);
        const { manifest, plugin } = loadedPlugin(options.plugins, options.datasource.pluginId);
        const sessionId = `${SESSION_PREFIX}${nextSession++}`;
        const opening = await namespaceOf({ session, capabilities: plugin.capabilities });
        const open: OpenSession = {
          session,
          capabilities: plugin.capabilities,
          running: 0,
          opening,
          moved: false,
          lastUsed: now(),
          lost: null,
        };
        const namespace = opening ?? null;
        sessions.set(sessionId, open);
        return {
          sessionId,
          pluginName: manifest.name,
          capabilities: plugin.capabilities,
          serverVersion: session.serverVersion,
          namespace,
        };
      },
      "session.close": async ({ sessionId }) => {
        const open = sessionFor(sessionId);
        sessions.delete(sessionId);
        await releaseHandlesOf(sessionId);
        await open.session.close();
        return null;
      },
      "statement.execute": ({ sessionId, sql, parameters, pageRows, fetchAllCap, timeoutSeconds }) =>
        runStatement(sessionId, sql, parameters, { pageRows, fetchAllCap }, timeoutSeconds ?? 0),
      "statement.cancel": async ({ sessionId }) => {
        const open = sessionFor(sessionId);
        if (!open.capabilities.includes("cancel") || open.session.cancel === undefined) {
          throw new EngineFailure({
            code: "invalidRequest",
            message: "This datasource's plugin does not declare the cancel capability.",
            hint: BUG_HINT,
          });
        }
        if (open.running > 0) await open.session.cancel();
        return null;
      },
      "script.split": ({ text }) => Promise.resolve(splitScript(text)),
      "sql.format": ({ text, options: format }) => Promise.resolve(formatText(text, format)),
      "sql.explainable": ({ sql, analyze }) => Promise.resolve(explainabilityOf(sqlLanguage(), sql, analyze)),
      "statement.explain": (request) => explainStatement(request),
      "transaction.setMode": ({ sessionId, mode }) =>
        transact(sessionId, (transactions) => transactions.setMode(mode), OPEN_TRANSACTION_HINT),
      "transaction.commit": ({ sessionId }) =>
        transact(sessionId, (transactions) => transactions.commit(), TRANSACTION_HINT),
      "transaction.rollback": ({ sessionId }) =>
        transact(sessionId, (transactions) => transactions.rollback(), TRANSACTION_HINT),
      "result.window": ({ handle, offset, limit }) =>
        Promise.resolve(results.window(ownedHandle(handle), offset, limit)),
      "result.release": async ({ handle }) => {
        const owner = handles.get(handle);
        if (owner === undefined) return null;
        forget(handle);
        if (cursors.get(owner) === handle) cursors.delete(owner);
        await results.release(handle);
        return null;
      },
      "result.fetchMore": async ({ handle, all, pageRows, fetchAllCap }) => {
        const state = await results
          .fetchMore(ownedHandle(handle), { all, pageRows, fetchAllCap })
          .catch((cause: unknown) => {
            throw statementFailed(cause, options.datasource.readOnly);
          });
        return track(handle, state);
      },
      "result.stopFetch": async ({ handle }) => track(handle, await results.stopFetch(ownedHandle(handle))),
      "result.sort": ({ handle, keys }) => {
        if (tables.has(ownedHandle(handle))) {
          throw new EngineFailure({
            code: "invalidRequest",
            message: "A table editor's rows are sorted by the database, not locally (decision 026).",
            hint: SERVER_SORT_HINT,
          });
        }
        return Promise.resolve(results.sort(handle, keys));
      },
      "result.extract": ({ handle, extractor, rows, columns }) => {
        const chosen = chosenColumns(ownedHandle(handle), columns);
        const writer = rowWriter(extractor, chosen, { dialect: sqlLanguage() });
        const picked = rowsIn(results.rows(handle), rows);
        const body = picked.map((row, index) => writer.row(project(row, columns), index)).join("");
        return Promise.resolve(writer.start() + body + writer.end(picked.length));
      },
      "export.start": async ({ source, format, path, stallSeconds }) => {
        absolutePath(path);
        const stallMs = stallSeconds * MS_PER_SECOND;
        if (source.kind === "table") return tasks.start(await tableJob(source, format, path), stallMs);
        return tasks.start(resultJob(source, format, path), stallMs);
      },
      "export.cancel": ({ taskId }) => {
        taskOf(taskId);
        tasks.cancel(taskId);
        return Promise.resolve(null);
      },
      "export.retry": ({ taskId, stallSeconds }) => {
        if (!taskOf(taskId).retryable) {
          throw new EngineFailure({
            code: "invalidRequest",
            message: "This export wrote rows the grid held, and they cannot be read again.",
            hint: "Run the statement again, then export its result.",
          });
        }
        return Promise.resolve(tasks.retry(taskId, stallSeconds * MS_PER_SECOND));
      },
      "export.list": () => Promise.resolve(tasks.list()),
      "catalog.namespaces": ({ refresh }) => introspect(({ cache }) => cache.namespaces(refresh)),
      "catalog.describe": ({ path, refresh }) => introspect(({ cache }) => cache.describe(path, refresh)),
      "catalog.qualifiedName": ({ path, name }) =>
        introspect(({ session }) => session.introspector?.qualifiedName(path, name) ?? name),
      "catalog.definition": ({ path, name }) => definitionOf(path, name),
      "sql.generate": ({ path, name, statement }) => generate(path, name, statement),
      "completion.complete": ({ text, offset, scope, current }) =>
        complete(scope === undefined ? { text, offset } : { text, offset, scope }, current),
      "navigation.resolve": ({ text, offset, current }) => resolve({ text, offset }, current),
      "table.query": (request) => queryTable(request),
      "table.count": ({ path, relation, where }) => countRows(path, relation, where),
      "table.condition": ({ handle, rows, columns }) => Promise.resolve(condition(handle, rows, columns)),
      "table.orderBy": ({ terms }) => Promise.resolve(orderClause(sqlLanguage(), terms)),
      "edits.preview": ({ handle, edits }) => Promise.resolve(editStatements(handle, edits)),
      "edits.submit": (request) => submit(request),
    };

    async function route<M extends EngineMethod>(request: RequestOf<M>): Promise<EngineResponse> {
      const run = routes[request.type] as (request: RequestOf<M>) => Promise<ResultOf<M>>;
      const result = await run(request);
      return { id: request.id, type: request.type, result } as EngineResponse;
    }

    return {
      async handle(message) {
        const parsed = engineRequestSchema.safeParse(message);
        if (!parsed.success) {
          return {
            id: readRequestId(message),
            type: "engine.error",
            error: {
              code: "invalidRequest",
              message: `The engine could not read the request: ${parsed.error.message}`,
              hint: BUG_HINT,
            },
          };
        }
        const request = parsed.data;
        const started = now();
        try {
          const response = await route(request);
          if (log !== null)
            logResponse(request, { result: (response as { result?: unknown }).result }, logContext(request, started));
          return response;
        } catch (cause) {
          const error = toEngineError(cause);
          if (log !== null) logResponse(request, { error, cause }, logContext(request, started));
          return { id: request.id, type: "engine.error", error };
        }
      },
      async close() {
        unsubscribe();
        const held = [...handles.keys()];
        handles.clear();
        statements.clear();
        tables.clear();
        cursors.clear();
        await settledWithin(Promise.allSettled(held.map((handle) => results.release(handle))), RELEASE_GRACE_MS);
        const open = [...sessions.values()];
        sessions.clear();
        await Promise.allSettled(open.map((entry) => entry.session.close()));
      },
    };
  }

  async function close(): Promise<void> {
    await tasks.close();
    const open = introspection;
    introspection = null;
    if (open === null) return;
    await open.then((entry) => entry.session.close()).catch(() => undefined);
  }

  return { connect, exportsSettled: () => tasks.settled(), close };
}
