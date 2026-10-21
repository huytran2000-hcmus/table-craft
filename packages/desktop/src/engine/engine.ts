import { CoreError, openSession, ResultStore, type PluginLoadResult } from "@table-craft/core";
import { isPluginError, type Capability, type Session } from "@table-craft/plugin-api";
import type {
  DatasourceConfig,
  EngineError,
  EngineMethod,
  EngineResponse,
  ProbeResult,
  RequestOf,
  ResultOf,
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

interface OpenSession {
  readonly session: Session;
  readonly capabilities: readonly Capability[];
  /** Statements in flight: `statement.execute` calls that have not answered yet. */
  running: number;
}

function loadedPlugin(
  plugins: readonly PluginLoadResult[],
  pluginId: string,
): {
  readonly name: string;
  readonly capabilities: readonly Capability[];
} {
  for (const entry of plugins) {
    if (entry.status === "loaded" && entry.manifest.id === pluginId) {
      return { name: entry.manifest.name, capabilities: entry.plugin.capabilities };
    }
  }
  // openSession has just connected through this plugin, so it is loaded.
  throw new Error(`Plugin "${pluginId}" opened a session but is not loaded.`);
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
    const plugin = loadedPlugin(options.plugins, options.datasource.pluginId);
    return { ok: true, pluginName: plugin.name, serverVersion: session.serverVersion, elapsedMs };
  } catch (cause) {
    return { ok: false, error: toEngineError(cause) };
  }
}

export function createEngine(options: EngineOptions): Engine {
  const results = new ResultStore();
  let nextSession = 1;

  function connect(): EngineConnection {
    const sessions = new Map<string, OpenSession>();
    /** Each live result handle, mapped to the session that produced it. */
    const handles = new Map<string, string>();

    function releaseHandlesOf(sessionId: string): void {
      for (const [handle, owner] of handles) {
        if (owner !== sessionId) continue;
        handles.delete(handle);
        results.release(handle);
      }
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

    const routes: { [M in EngineMethod]: (request: RequestOf<M>) => Promise<ResultOf<M>> } = {
      "session.open": async () => {
        const session = await connectDatasource(options);
        const plugin = loadedPlugin(options.plugins, options.datasource.pluginId);
        const sessionId = `${SESSION_PREFIX}${nextSession++}`;
        sessions.set(sessionId, { session, capabilities: plugin.capabilities, running: 0 });
        return {
          sessionId,
          pluginName: plugin.name,
          capabilities: plugin.capabilities,
          serverVersion: session.serverVersion,
        };
      },
      "session.close": async ({ sessionId }) => {
        const open = sessionFor(sessionId);
        sessions.delete(sessionId);
        releaseHandlesOf(sessionId);
        await open.session.close();
        return null;
      },
      "statement.execute": async ({ sessionId, sql }) => {
        const open = sessionFor(sessionId);
        open.running += 1;
        try {
          const summary = await open.session
            .execute(sql)
            .then((result) => results.put(result))
            .catch((cause: unknown) => {
              throw statementFailed(cause, options.datasource.readOnly);
            });
          if (sessions.get(sessionId) !== open) {
            // The session closed while the statement ran; nobody is left to release this result.
            results.release(summary.handle);
            sessionFor(sessionId);
          }
          handles.set(summary.handle, sessionId);
          return { ...summary, firstWindow: results.window(summary.handle, 0) };
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
      "result.window": ({ handle, offset, limit }) =>
        Promise.resolve(results.window(ownedHandle(handle), offset, limit)),
      "result.release": ({ handle }) => {
        if (handles.delete(handle)) results.release(handle);
        return Promise.resolve(null);
      },
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
        for (const handle of handles.keys()) results.release(handle);
        handles.clear();
        const open = [...sessions.values()];
        sessions.clear();
        await Promise.allSettled(open.map((entry) => entry.session.close()));
      },
    };
  }

  return { connect };
}
