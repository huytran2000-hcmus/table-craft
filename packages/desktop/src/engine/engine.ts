import { open as openFile, rename, rm } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
  CatalogCache,
  CoreError,
  loadedPlugin,
  openSession,
  project,
  ResultStore,
  rowWriter,
  type ExtractorKind,
  type PluginLoadResult,
  type ResultState,
} from "@table-craft/core";
import {
  isPluginError,
  type Capability,
  type Column,
  type Row,
  type Session,
  type SqlLanguage,
  type Transactions,
} from "@table-craft/plugin-api";
import type {
  ClassifiedStatement,
  DatasourceConfig,
  EngineError,
  EngineMethod,
  EngineResponse,
  ExportedResult,
  ProbeResult,
  RequestOf,
  ResultOf,
  RowRange,
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

  function connect(): EngineConnection {
    const sessions = new Map<string, OpenSession>();
    /** Each live result handle, mapped to the session that produced it. */
    const handles = new Map<string, string>();
    /** The one result per session whose cursor is still open (decision 025). */
    const cursors = new Map<string, string>();

    async function releaseHandlesOf(sessionId: string): Promise<void> {
      cursors.delete(sessionId);
      const owned = [...handles].filter(([, owner]) => owner === sessionId).map(([handle]) => handle);
      for (const handle of owned) handles.delete(handle);
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
      "statement.execute": async ({ sessionId, sql }) => {
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
      },
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
        handles.delete(handle);
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
      "result.sort": ({ handle, keys }) => Promise.resolve(results.sort(ownedHandle(handle), keys)),
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
