import { bridge } from "@table-craft/desktop/renderer/bridge.js";
import {
  autosave,
  bridgeConsoleFiles,
  firstFreeName,
  type ConsoleFileAccess,
} from "@table-craft/desktop/renderer/state/consoleFiles.js";
import { consolesOf, openTransactions, useConsoles } from "@table-craft/desktop/renderer/state/consoles.js";
import { datasourceById, useDatasources } from "@table-craft/desktop/renderer/state/datasources.js";
import { useLayout } from "@table-craft/desktop/renderer/state/layout.js";
import { useModal } from "@table-craft/desktop/renderer/state/modal.js";
import { activeTab, useTabs, type Tab } from "@table-craft/desktop/renderer/state/tabs.js";

const CONSOLE_ID_PREFIX = "console-";
const COMMIT = "commit";
const ROLLBACK = "rollback";
let consolesOpened = 0;
/** One allocation at a time per datasource, so two quick New Consoles never take the same name. */
const allocating = new Map<string, Promise<void>>();
const files: ConsoleFileAccess = bridgeConsoleFiles();

function newTab(name: string): Tab {
  return { id: `${CONSOLE_ID_PREFIX}${String(consolesOpened++)}`, kind: "console", title: name };
}

/** Whether the datasource's consoles are kept on disk: an ephemeral one is never saved (decision 018). */
export function persists(datasourceId: string): boolean {
  const view = datasourceById(useDatasources.getState(), datasourceId);
  return view !== undefined && !view.ephemeral;
}

/** Opens a console tab on the datasource, named with the first free `console`, `console_1`… (decision 16). */
export function openConsole(datasourceId: string, sql?: string): Promise<void> {
  const previous = allocating.get(datasourceId) ?? Promise.resolve();
  const opened = previous.then(async () => {
    const saved = persists(datasourceId) ? await files.list(datasourceId).catch(() => []) : [];
    const open = consolesOf(useConsoles.getState().consoles, datasourceId).map(
      (id) => useConsoles.getState().consoles[id]?.name ?? "",
    );
    const name = firstFreeName([...saved, ...open]);
    const tab = newTab(name);
    useTabs.getState().open(tab);
    void useConsoles.getState().open(tab.id, datasourceId, { name, sql });
  });
  allocating.set(datasourceId, opened);
  return opened;
}

/**
 * Reopens the console tabs the layout remembers, with their saved text, each disconnected until
 * its first Run: launching connects nothing (decision 17).
 */
export async function restoreConsoles(): Promise<void> {
  const remembered = useLayout.getState().layout.openConsoles.filter((entry) => persists(entry.datasourceId));
  const texts = await Promise.all(
    remembered.map((entry) => files.read(entry.datasourceId, entry.name).catch(() => null)),
  );
  let active: string | null = null;
  for (const [index, entry] of remembered.entries()) {
    const tab = newTab(entry.name);
    useTabs.getState().open(tab);
    void useConsoles.getState().open(tab.id, entry.datasourceId, {
      name: entry.name,
      sql: texts[index] ?? "",
      connect: false,
    });
    if (entry.active) active = tab.id;
  }
  if (active !== null) useTabs.getState().activate(active);
}

/** Keeps the layout's list of open console tabs in step with the tab strip. */
export function rememberOpenConsoles(): () => void {
  const remember = () => {
    const strip = useTabs.getState();
    const current = activeTab(strip)?.id ?? null;
    const { consoles } = useConsoles.getState();
    useLayout.getState().setOpenConsoles(
      strip.tabs.flatMap((tab) => {
        const session = consoles[tab.id];
        if (tab.kind !== "console" || session === undefined || !persists(session.datasourceId)) return [];
        return [{ datasourceId: session.datasourceId, name: session.name, active: tab.id === current }];
      }),
    );
  };
  remember();
  const offTabs = useTabs.subscribe(remember);
  const offConsoles = useConsoles.subscribe((state, previous) => {
    if (Object.keys(state.consoles).length !== Object.keys(previous.consoles).length) remember();
  });
  return () => {
    offTabs();
    offConsoles();
  };
}

/** Writes each console as it changes and when it closes, unless its datasource is gone or ephemeral. */
export function autosaveConsoles(): () => void {
  return useConsoles.subscribe((state, previous) => {
    for (const [id, session] of Object.entries(state.consoles)) {
      const before = previous.consoles[id];
      if (before === undefined || before.sql === session.sql || !persists(session.datasourceId)) continue;
      autosave.changed(session.datasourceId, session.name, session.sql);
    }
    for (const [id, session] of Object.entries(previous.consoles)) {
      if (id in state.consoles) continue;
      if (persists(session.datasourceId)) void autosave.closed(session.datasourceId, session.name, session.sql);
      else autosave.discard(session.datasourceId);
    }
  });
}

/**
 * Asks once whether to commit or roll back the open transactions in `consoleIds`, then does it;
 * false when the user cancelled or an end failed, which its console's Output explains.
 */
export async function settleTransactions(consoleIds: readonly string[], verb: string): Promise<boolean> {
  const { consoles } = useConsoles.getState();
  const open = consoleIds.filter((id) => consoles[id]?.transactionOpen === true);
  if (open.length === 0) return true;
  const tabs = useTabs.getState().tabs;
  const answer = await useModal.getState().ask({
    kind: "choice",
    title: open.length === 1 ? "Open transaction" : "Open transactions",
    message: `${open.length === 1 ? "This console has" : "These consoles have"} uncommitted changes. Commit or roll back to ${verb}.`,
    items: open.map((id) => {
      const session = consoles[id];
      const datasource = datasourceById(useDatasources.getState(), session?.datasourceId ?? "");
      const title = tabs.find((tab) => tab.id === id)?.title ?? session?.name ?? id;
      return { label: datasource === undefined ? title : `${title} [${datasource.name}]`, detail: "" };
    }),
    choices: [
      { id: COMMIT, label: "Commit", variant: "primary" },
      { id: ROLLBACK, label: "Rollback", variant: "danger" },
    ],
  });
  if (answer === null) return false;
  const store = useConsoles.getState();
  const ended = await Promise.all(open.map((id) => (answer === COMMIT ? store.commit(id) : store.rollback(id))));
  return ended.every(Boolean);
}

/** Closes tabs as `close` picks them, once their consoles' open transactions are settled (decision 15). */
export async function closeTabs(ids: readonly string[], close: () => readonly Tab[]): Promise<void> {
  if (!(await settleTransactions(ids, "close"))) return;
  for (const tab of close()) if (tab.kind === "console") useConsoles.getState().close(tab.id);
}

export async function disconnectDatasource(datasourceId: string): Promise<void> {
  if (!(await settleTransactions(consolesOf(useConsoles.getState().consoles, datasourceId), "disconnect"))) return;
  await useDatasources.getState().disconnect(datasourceId);
}

/** Main holds a close or quit until the window settles its transactions and saves its consoles. */
export function answerCloseRequests(): () => void {
  return bridge().onCloseRequested(() => {
    void (async () => {
      const proceed = await settleTransactions(openTransactions(useConsoles.getState().consoles), "quit");
      if (proceed) await autosave.flush();
      await bridge().answerClose(proceed);
    })();
  });
}
