import type {
  HistoryEntry,
  HistoryStatement,
  InvokeResult,
  TableCraftBridge,
} from "@table-craft/desktop/preload/bridge.js";
import { bridge } from "@table-craft/desktop/renderer/bridge.js";
import { datasourceById, useDatasources } from "@table-craft/desktop/renderer/state/datasources.js";

/** A history search or clear main could not do; `hint` says what to try. */
export class HistoryFailure extends Error {
  override readonly name = "HistoryFailure";

  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
  }
}

/** The renderer's side of query history (decision 030); recording never fails a run. */
export interface HistoryClient {
  /** Fire-and-forget: a failure is logged, never thrown. Skips an ephemeral datasource. */
  readonly record: (entry: HistoryEntry) => void;
  /** Rejects with a `HistoryFailure`. */
  readonly search: (datasourceId: string, query: string) => Promise<readonly HistoryStatement[]>;
  /** Rejects with a `HistoryFailure`. */
  readonly clear: (datasourceId: string) => Promise<void>;
}

export interface HistoryClientOptions {
  readonly bridge: () => Pick<TableCraftBridge, "historyRecord" | "historySearch" | "historyClear">;
  /** Decision 018: the `TABLE_CRAFT_DATASOURCE` datasource's statements are not kept, as its consoles are not. */
  readonly isEphemeral: (datasourceId: string) => boolean;
  readonly log: (message: string, cause: unknown) => void;
}

async function unwrap<T>(pending: Promise<InvokeResult<T>>): Promise<T> {
  const answer = await pending;
  if (!answer.ok) throw new HistoryFailure(answer.error.message, answer.error.hint);
  return answer.value;
}

export function createHistoryClient(options: HistoryClientOptions): HistoryClient {
  return {
    record(entry) {
      if (options.isEphemeral(entry.datasourceId)) return;
      let pending: Promise<InvokeResult<null>>;
      try {
        pending = options.bridge().historyRecord(entry);
      } catch (cause) {
        options.log("could not record query history", cause);
        return;
      }
      void pending.then(
        (answer) => {
          if (!answer.ok) options.log("could not record query history", answer.error);
        },
        (cause: unknown) => options.log("could not record query history", cause),
      );
    },
    search: (datasourceId, query) => unwrap(options.bridge().historySearch(datasourceId, query)),
    async clear(datasourceId) {
      await unwrap(options.bridge().historyClear(datasourceId));
    },
  };
}

export const history = createHistoryClient({
  bridge,
  isEphemeral: (datasourceId) => datasourceById(useDatasources.getState(), datasourceId)?.ephemeral ?? true,
  log: (message, cause) => console.error(`table-craft: ${message}`, cause),
});
