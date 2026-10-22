import type { QueryHistory } from "@table-craft/core";
import { z } from "@table-craft/plugin-api";
import { ConsoleFileError, type ConsoleFiles } from "@table-craft/desktop/main/consoleFiles.js";
import { draftSchema } from "@table-craft/desktop/main/datasources.js";
import { SecretStoreError } from "@table-craft/desktop/main/secrets.js";
import { settingsSchema, type SettingsService } from "@table-craft/desktop/main/settings.js";
import { DatasourceError, type DatasourceService } from "@table-craft/desktop/main/service.js";
import {
  HISTORY_OUTCOMES,
  HISTORY_SOURCES,
  INVOKE_CHANNELS,
  type AppInfo,
  type BridgeFailure,
  type HistoryEntry,
  type InvokeResult,
  type MenuPoint,
  type SaveDatasourceRequest,
  type WindowState,
} from "@table-craft/desktop/preload/bridge.js";

const BUG_HINT = "This is a TableCraft bug; restart the app and report it.";

const secretChange = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("keep") }),
  z.strictObject({ action: z.literal("set"), value: z.string() }),
  z.strictObject({ action: z.literal("clear") }),
]);

const saveRequest = z.strictObject({
  datasource: draftSchema,
  secrets: z.record(z.string(), secretChange),
}) satisfies z.ZodType<SaveDatasourceRequest>;

const idRequest = z.strictObject({ id: z.string().min(1) });
const connectRequest = z.strictObject({
  datasourceId: z.string().min(1),
  secrets: z.record(z.string(), z.string()).optional(),
});
const disconnectRequest = z.strictObject({ datasourceId: z.string().min(1) });
const chooseFileRequest = z.strictObject({ title: z.string() });
const saveFileRequest = z.strictObject({ title: z.string(), defaultName: z.string() });
const consoleListRequest = z.strictObject({ datasourceId: z.string().min(1) });
const consoleRequest = z.strictObject({ datasourceId: z.string().min(1), name: z.string().min(1) });
const consoleWriteRequest = z.strictObject({
  datasourceId: z.string().min(1),
  name: z.string().min(1),
  text: z.string(),
});
const historyEntry = z.strictObject({
  datasourceId: z.string().min(1),
  sql: z.string(),
  startedAt: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  outcome: z.enum(HISTORY_OUTCOMES),
  rowCount: z.number().int().nonnegative().nullable(),
  message: z.string().nullable(),
  source: z.enum(HISTORY_SOURCES),
}) satisfies z.ZodType<HistoryEntry>;
const historySearchRequest = z.strictObject({ datasourceId: z.string().min(1), query: z.string() });
const historyClearRequest = z.strictObject({ datasourceId: z.string().min(1) });
const answerCloseRequest = z.strictObject({ proceed: z.boolean() });
const menuPoint = z.strictObject({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
}) satisfies z.ZodType<MenuPoint>;
const noRequest = z.undefined();

/** The slice of `ipcMain` the handlers need; `sender` is the window that asked. */
export interface InvokeRegistrar<Sender> {
  handle(channel: string, listener: (event: { readonly sender: Sender }, ...args: unknown[]) => unknown): void;
}

export interface IpcOptions<Sender> {
  readonly service: DatasourceService<Sender>;
  readonly consoles: ConsoleFiles;
  readonly history: Pick<QueryHistory, "record" | "search" | "clear">;
  readonly chooseFile: (sender: Sender, title: string) => Promise<string | null>;
  readonly saveFile: (sender: Sender, title: string, defaultName: string) => Promise<string | null>;
  /** The renderer's answer to a held close (`CHANNELS.closeRequested`). */
  readonly answerClose: (sender: Sender, proceed: boolean) => void;
  readonly settings: SettingsService;
  /** Creates `<userData>/themes/` if missing and shows it in the file manager. */
  readonly openThemesFolder: () => Promise<void>;
  readonly appInfo: () => AppInfo;
  /** Pops the application menu in the sender's window (decision 034). */
  readonly popupMenu: (sender: Sender, point: MenuPoint) => void;
  readonly windowState: (sender: Sender) => WindowState;
  /** Quits through the close guard and starts again. */
  readonly relaunch: () => void;
  readonly log: (message: string, cause: unknown) => void;
}

function failureOf(cause: unknown): BridgeFailure | null {
  if (cause instanceof DatasourceError || cause instanceof SecretStoreError || cause instanceof ConsoleFileError) {
    return { message: cause.message, hint: cause.hint };
  }
  return null;
}

/**
 * Every renderer-to-main call (plan 004). The renderer is untrusted input, so each payload is
 * parsed before it reaches the service, and a failure answers as a value: `ipcMain.handle`
 * rejections lose everything but the message.
 */
export function registerIpc<Sender>(ipc: InvokeRegistrar<Sender>, options: IpcOptions<Sender>): void {
  function handle<Schema extends z.ZodType, T>(
    channel: string,
    schema: Schema,
    run: (request: z.output<Schema>, sender: Sender) => Promise<T> | T,
  ): void {
    ipc.handle(channel, async (event, payload): Promise<InvokeResult<T>> => {
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        options.log(`rejected ${channel}`, parsed.error);
        return {
          ok: false,
          error: { message: `Main could not read the request: ${parsed.error.message}`, hint: BUG_HINT },
        };
      }
      try {
        return { ok: true, value: await run(parsed.data, event.sender) };
      } catch (cause) {
        const failure = failureOf(cause);
        if (failure !== null) return { ok: false, error: failure };
        options.log(`${channel} failed`, cause);
        const message = cause instanceof Error ? cause.message : String(cause);
        return { ok: false, error: { message, hint: BUG_HINT } };
      }
    });
  }

  const { service } = options;
  handle(INVOKE_CHANNELS.listDatasources, noRequest, () => service.list());
  handle(INVOKE_CHANNELS.listPlugins, noRequest, () => service.plugins());
  handle(INVOKE_CHANNELS.saveDatasource, saveRequest, (request) => service.save(request));
  handle(INVOKE_CHANNELS.deleteDatasource, idRequest, async ({ id }) => {
    await service.delete(id);
    return null;
  });
  handle(INVOKE_CHANNELS.testDatasource, saveRequest, (request) => service.test(request));
  handle(INVOKE_CHANNELS.connectEngine, connectRequest, ({ datasourceId, secrets }, sender) =>
    service.connect(datasourceId, secrets ?? {}, sender),
  );
  handle(INVOKE_CHANNELS.disconnectEngine, disconnectRequest, async ({ datasourceId }) => {
    await service.disconnect(datasourceId);
    return null;
  });
  handle(INVOKE_CHANNELS.chooseFile, chooseFileRequest, ({ title }, sender) => options.chooseFile(sender, title));
  handle(INVOKE_CHANNELS.saveFile, saveFileRequest, ({ title, defaultName }, sender) =>
    options.saveFile(sender, title, defaultName),
  );
  handle(INVOKE_CHANNELS.answerClose, answerCloseRequest, ({ proceed }, sender) => {
    options.answerClose(sender, proceed);
    return null;
  });

  const { consoles } = options;
  handle(INVOKE_CHANNELS.listConsoles, consoleListRequest, ({ datasourceId }) => consoles.list(datasourceId));
  handle(INVOKE_CHANNELS.readConsole, consoleRequest, ({ datasourceId, name }) => consoles.read(datasourceId, name));
  handle(INVOKE_CHANNELS.writeConsole, consoleWriteRequest, async ({ datasourceId, name, text }) => {
    await consoles.write(datasourceId, name, text);
    return null;
  });
  handle(INVOKE_CHANNELS.deleteConsole, consoleRequest, async ({ datasourceId, name }) => {
    await consoles.delete(datasourceId, name);
    return null;
  });

  const { settings } = options;
  handle(INVOKE_CHANNELS.readSettings, noRequest, () => settings.snapshot());
  handle(INVOKE_CHANNELS.writeSettings, settingsSchema, async (document) => {
    await settings.write(document);
    return null;
  });
  handle(INVOKE_CHANNELS.reloadThemes, noRequest, async () => {
    await settings.reloadThemes();
    return null;
  });
  handle(INVOKE_CHANNELS.openThemesFolder, noRequest, async () => {
    await options.openThemesFolder();
    return null;
  });
  handle(INVOKE_CHANNELS.appInfo, noRequest, () => options.appInfo());
  handle(INVOKE_CHANNELS.popupMenu, menuPoint, (point, sender) => {
    options.popupMenu(sender, point);
    return null;
  });
  handle(INVOKE_CHANNELS.windowState, noRequest, (_request, sender) => options.windowState(sender));
  handle(INVOKE_CHANNELS.relaunch, noRequest, () => {
    options.relaunch();
    return null;
  });

  const { history } = options;
  handle(INVOKE_CHANNELS.historyRecord, historyEntry, (entry) => {
    history.record(entry);
    return null;
  });
  handle(INVOKE_CHANNELS.historySearch, historySearchRequest, ({ datasourceId, query }) =>
    history.search(datasourceId, query),
  );
  handle(INVOKE_CHANNELS.historyClear, historyClearRequest, ({ datasourceId }) => {
    history.clear(datasourceId);
    return null;
  });
}
