import { CoreError, openSession, ResultStore, type PluginLoadResult } from "@table-craft/core";
import type { Session } from "@table-craft/plugin-api";
import type {
  DatasourceConfig,
  EngineError,
  EngineMethod,
  EngineResponse,
  RequestOf,
  ResultOf,
} from "@table-craft/desktop/engine/protocol.js";
import { engineRequestSchema, readRequestId } from "@table-craft/desktop/engine/requests.js";

const SESSION_PREFIX = "session-";

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
  return { code: "internal", message, hint: "This is a table-craft bug; restart the app and report it." };
}

function statementFailed(cause: unknown): EngineFailure {
  const message = cause instanceof Error ? cause.message : String(cause);
  return new EngineFailure({ code: "statementFailed", message, hint: "Fix the statement and run it again." });
}

export function createEngine(options: EngineOptions): Engine {
  const results = new ResultStore();
  let nextSession = 1;

  function connect(): EngineConnection {
    const sessions = new Map<string, Session>();
    const handles = new Set<string>();

    function sessionFor(sessionId: string): Session {
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
        const session = await openSession(options.plugins, options.datasource.pluginId, options.datasource.config);
        const sessionId = `${SESSION_PREFIX}${nextSession++}`;
        sessions.set(sessionId, session);
        return { sessionId };
      },
      "statement.execute": async ({ sessionId, sql }) => {
        const session = sessionFor(sessionId);
        const summary = await session
          .execute(sql)
          .then((result) => results.put(result))
          .catch((cause: unknown) => {
            throw statementFailed(cause);
          });
        handles.add(summary.handle);
        return { ...summary, firstWindow: results.window(summary.handle, 0) };
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
              hint: "This is a table-craft bug; restart the app and report it.",
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
        for (const handle of handles) results.release(handle);
        handles.clear();
        const open = [...sessions.values()];
        sessions.clear();
        await Promise.allSettled(open.map((session) => session.close()));
      },
    };
  }

  return { connect };
}
