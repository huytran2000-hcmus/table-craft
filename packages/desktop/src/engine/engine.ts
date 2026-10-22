import { open as openFile, rename, rm } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
  CatalogCache,
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
  type ExtractorKind,
  type PluginLoadResult,
  type ResultState,
  type RowEdit,
} from "@table-craft/core";
import {
  isPluginError,
  type Capability,
  type Column,
  type ColumnMeta,
  type Relation,
  type Row,
  type Session,
  type SqlLanguage,
  type Transactions,
  type WireValue,
} from "@table-craft/plugin-api";
import type {
  ClassifiedStatement,
  ConditionColumn,
  DatasourceConfig,
  EngineError,
  EngineMethod,
  EngineResponse,
  ExecutedStatement,
  ExportedResult,
  ProbeResult,
  ReferencingKey,
  RequestOf,
  ResultOf,
  RowRange,
  TableQuery,
  TransactionState,
} from "@table-craft/desktop/engine/protocol.js";
import { engineRequestSchema, readRequestId } from "@table-craft/desktop/engine/requests.js";

const SESSION_PREFIX = "session-";
const BUG_HINT = "This is a table-craft bug; restart the app and report it.";

export interface EngineOptions {
  readonly datasource: DatasourceConfig;
  readonly plugins: readonly PluginLoadResult[];
}

/** One renderer port's view of the engine. Its sessions and results die with it. */
export interface EngineConnection {
  handle(message: unknown): Promise<EngineResponse>;
  close(): Promise<void>;
}

export interface Engine {
  connect(): EngineConnection;
  /** Closes what the engine holds for every connection: the introspection session. */
  close(): Promise<void>;
}

class EngineFailure extends Error {
  constructor(readonly error: EngineError) {
    super(error.message);
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
  return new EngineFailure({
    code: "connectionFailed",
    message: `Could not connect: ${cause.message}`,
    hint: "Check that the database is running and that the host, port, user and password are right.",
  });
}

const STATEMENT_HINT = "Fix the statement and run it again.";
const READ_ONLY_STATEMENT_HINT =
  "This data source is read-only, so writes are refused; clear Read-only in its properties to write.";

function statementFailed(cause: unknown, readOnly: boolean): EngineFailure {
  if (isPluginError(cause) && cause.code === "cancelled") {
    return new EngineFailure({
      code: "cancelled",
      message: "The statement was cancelled.",
      hint: "Run it again when ready.",
    });
  }
  return new EngineFailure({
    code: "statementFailed",
    message: messageOf(cause),
    hint: readOnly ? READ_ONLY_STATEMENT_HINT : STATEMENT_HINT,
  });
}

const INTROSPECTION_HINT = "Check that this user may read the schema, then choose Synchronize (⌥⌘Y) to try again.";

function introspectionFailed(cause: unknown): unknown {
  if (!isPluginError(cause) || cause.code !== "introspectionFailed") return cause;
  return new EngineFailure({ code: "introspectionFailed", message: cause.message, hint: INTROSPECTION_HINT });
}

interface Introspection {
  readonly session: Session;
  readonly cache: CatalogCache;
}

interface OpenSession {
  readonly session: Session;
  readonly capabilities: readonly Capability[];
  /** Statements in flight: `statement.execute` calls that have not answered yet. */
  running: number;
}

function connectDatasource(options: EngineOptions): Promise<Session> {
  const { pluginId, config, readOnly } = options.datasource;
  return openSession(options.plugins, pluginId, config, { readOnly }).catch((cause: unknown) => {
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
const EXPORT_HINT = "Check that the folder exists and is writable, then export again.";
const TEMP_SUFFIX = ".tmp";
/** Characters gathered before a write, so an export of a million rows is not a million writes. */
const EXPORT_CHUNK_CHARS = 1 << 16;

/** Writes `chunks` to `path` through a temporary file renamed into place, removed on failure. */
async function writeAtomically(path: string, chunks: AsyncIterable<string>): Promise<number> {
  const temporary = `${path}${TEMP_SUFFIX}`;
  const file = await openFile(temporary, "w");
  let bytes = 0;
  try {
    let pending = "";
    for await (const chunk of chunks) {
      pending += chunk;
      if (pending.length < EXPORT_CHUNK_CHARS) continue;
      bytes += (await file.write(pending)).bytesWritten;
      pending = "";
    }
    if (pending !== "") bytes += (await file.write(pending)).bytesWritten;
    await file.close();
    await rename(temporary, path);
    return bytes;
  } catch (cause) {
    await file.close().catch(() => undefined);
    await rm(temporary, { force: true });
    throw cause;
  }
}

function rowsIn(rows: readonly Row[], ranges: readonly RowRange[]): Row[] {
  return ranges.flatMap((range) => rows.slice(range.from, Math.max(range.from, range.to)));
}
const OPEN_TRANSACTION_HINT = "Commit or roll back the open transaction first.";
const SYNCHRONIZE_HINT = "Choose Synchronize (⌥⌘Y), then open the table again.";
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
    return language.split(text).map((span) => ({ ...span, ...language.classify(span.sql) }));
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

  function connect(): EngineConnection {
    const sessions = new Map<string, OpenSession>();
    /** Each live result handle, mapped to the session that produced it. */
    const handles = new Map<string, string>();
    /** The one result per session whose cursor is still open (decision 025). */
    const cursors = new Map<string, string>();
    /** The handles `table.query` produced, with what editing them needs. */
    const tables = new Map<string, TableResult>();

    function forget(handle: string): void {
      handles.delete(handle);
      tables.delete(handle);
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

    async function exportResult(
      handle: string,
      extractor: ExtractorKind,
      path: string,
      columns: readonly number[],
    ): Promise<ExportedResult> {
      if (!isAbsolute(path)) {
        throw new EngineFailure({
          code: "invalidRequest",
          message: `Export needs an absolute path, not "${path}".`,
          hint: BUG_HINT,
        });
      }
      const started = now();
      const writer = rowWriter(extractor, chosenColumns(handle, columns), { dialect: sqlLanguage() });
      let count = 0;
      const held = results.rows(handle);
      const bytes = await results
        .drain(handle, (rest) =>
          writeAtomically(
            path,
            (async function* chunks(): AsyncGenerator<string, void, undefined> {
              yield writer.start();
              for (const row of held) yield writer.row(project(row, columns), count++);
              for await (const row of rest) yield writer.row(project(row, columns), count++);
              yield writer.end(count);
            })(),
          ),
        )
        .catch((cause: unknown) => {
          if (isPluginError(cause)) throw statementFailed(cause, options.datasource.readOnly);
          throw new EngineFailure({
            code: "statementFailed",
            message: `Export failed: ${messageOf(cause)}`,
            hint: EXPORT_HINT,
          });
        });
      track(handle, results.state(handle));
      return { path, rows: count, bytes, elapsedMs: now() - started };
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

    async function runStatement(sessionId: string, sql: string): Promise<ExecutedStatement> {
      const open = sessionFor(sessionId);
      open.running += 1;
      try {
        // Awaited only when there is one: a needless await would let a cancel overtake the execute.
        if (cursors.has(sessionId)) await closeCursorOf(sessionId);
        const summary = await open.session
          .execute(sql)
          .then((result) => results.put(result))
          .catch((cause: unknown) => {
            throw statementFailed(cause, options.datasource.readOnly);
          });
        if (sessions.get(sessionId) !== open) {
          // The session closed while the statement ran; nobody is left to release this result.
          await results.release(summary.handle);
          sessionFor(sessionId);
        }
        handles.set(summary.handle, sessionId);
        if (summary.cursorOpen) cursors.set(sessionId, summary.handle);
        return {
          ...summary,
          firstWindow: results.window(summary.handle, 0),
          transactionOpen: open.session.transactions?.open ?? false,
        };
      } finally {
        open.running -= 1;
      }
    }

    async function queryTable(request: RequestOf<"table.query">): Promise<TableQuery> {
      const open = sessionFor(request.sessionId);
      const { relation, qualified } = await relationOf(request.path, request.relation);
      const sql = tableSelect(qualified, request);
      const statement = await runStatement(request.sessionId, sql);
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
      try {
        await closeCursorOf(sessionId);
        await change(transactions);
      } catch (cause) {
        throw new EngineFailure({ code: "statementFailed", message: messageOf(cause), hint });
      }
      return { mode: transactions.mode, transactionOpen: transactions.open };
    }

    const routes: { [M in EngineMethod]: (request: RequestOf<M>) => Promise<ResultOf<M>> } = {
      "session.open": async () => {
        const session = await connectDatasource(options);
        const { manifest, plugin } = loadedPlugin(options.plugins, options.datasource.pluginId);
        const sessionId = `${SESSION_PREFIX}${nextSession++}`;
        sessions.set(sessionId, { session, capabilities: plugin.capabilities, running: 0 });
        return {
          sessionId,
          pluginName: manifest.name,
          capabilities: plugin.capabilities,
          serverVersion: session.serverVersion,
        };
      },
      "session.close": async ({ sessionId }) => {
        const open = sessionFor(sessionId);
        sessions.delete(sessionId);
        await releaseHandlesOf(sessionId);
        await open.session.close();
        return null;
      },
      "statement.execute": ({ sessionId, sql }) => runStatement(sessionId, sql),
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
      "result.fetchMore": async ({ handle, all }) => {
        const state = await results.fetchMore(ownedHandle(handle), { all }).catch((cause: unknown) => {
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
      "result.export": ({ handle, extractor, path, columns }) =>
        exportResult(ownedHandle(handle), extractor, path, columns),
      "catalog.namespaces": ({ refresh }) => introspect(({ cache }) => cache.namespaces(refresh)),
      "catalog.describe": ({ path, refresh }) => introspect(({ cache }) => cache.describe(path, refresh)),
      "catalog.qualifiedName": ({ path, name }) =>
        introspect(({ session }) => session.introspector?.qualifiedName(path, name) ?? name),
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
        try {
          return await route(parsed.data);
        } catch (cause) {
          return { id: parsed.data.id, type: "engine.error", error: toEngineError(cause) };
        }
      },
      async close() {
        const held = [...handles.keys()];
        handles.clear();
        tables.clear();
        cursors.clear();
        await Promise.all(held.map((handle) => results.release(handle)));
        const open = [...sessions.values()];
        sessions.clear();
        await Promise.allSettled(open.map((entry) => entry.session.close()));
      },
    };
  }

  async function close(): Promise<void> {
    const open = introspection;
    introspection = null;
    if (open === null) return;
    await open.then((entry) => entry.session.close()).catch(() => undefined);
  }

  return { connect, close };
}
