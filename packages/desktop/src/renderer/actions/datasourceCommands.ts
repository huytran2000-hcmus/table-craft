import type { DatasourceView, InvokeResult } from "@table-craft/desktop/preload/bridge.js";
import { bridge } from "@table-craft/desktop/renderer/bridge.js";
import { useConsoles } from "@table-craft/desktop/renderer/state/consoles.js";
import { useDatasources } from "@table-craft/desktop/renderer/state/datasources.js";
import { useModal } from "@table-craft/desktop/renderer/state/modal.js";
import { useTabs, type Tab } from "@table-craft/desktop/renderer/state/tabs.js";

const CONSOLE_TITLE = "console";
const CONSOLE_ID_PREFIX = "console-";
let consolesOpened = 0;
/** Per datasource, as DataGrip numbers them: `console`, then `console_1`, `console_2`. */
const titlesUsed = new Map<string, number>();

export function openConsole(datasourceId: string, sql?: string): void {
  const index = titlesUsed.get(datasourceId) ?? 0;
  titlesUsed.set(datasourceId, index + 1);
  const tab: Tab = {
    id: `${CONSOLE_ID_PREFIX}${String(consolesOpened++)}`,
    kind: "console",
    title: index === 0 ? CONSOLE_TITLE : `${CONSOLE_TITLE}_${String(index)}`,
  };
  useTabs.getState().open(tab);
  void useConsoles.getState().open(tab.id, datasourceId, sql);
}

/** Main's answer, or a notice saying what went wrong and null. */
async function settle<T>(title: string, pending: Promise<InvokeResult<T>>): Promise<T | null> {
  const answer = await pending;
  if (answer.ok) return answer.value;
  await useModal.getState().ask({ kind: "notice", title, ...answer.error });
  return null;
}

export async function deleteDatasource(view: DatasourceView): Promise<void> {
  const consoles = Object.values(useConsoles.getState().consoles).filter(
    (session) => session.datasourceId === view.id,
  ).length;
  const closing = consoles === 0 ? "" : ` Its ${String(consoles)} open console${consoles === 1 ? "" : "s"} will close.`;
  const confirmed = await useModal.getState().ask({
    kind: "confirm",
    title: "Delete Data Source",
    message: `Delete "${view.name}"?${view.storedSecrets.length === 0 ? "" : " Its saved password is removed too."}${closing}`,
    confirm: "Delete",
    destructive: true,
  });
  if (confirmed === null) return;
  // Main broadcasts the new list; `wireStores` closes the consoles when it arrives.
  await settle("Could not delete the data source", bridge().deleteDatasource(view.id));
}

/** Saves the datasource with a new folder; its secrets stay as they are. */
export async function moveToFolder(view: DatasourceView, folder: string | null): Promise<void> {
  const { storedSecrets: _stored, ephemeral: _ephemeral, ...datasource } = view;
  await settle(
    "Could not move the data source",
    bridge().saveDatasource({ datasource: { ...datasource, folder }, secrets: {} }),
  );
}

export async function askMoveToFolder(view: DatasourceView): Promise<void> {
  const folder = await useModal.getState().ask({
    kind: "text",
    title: "Move to Folder",
    label: "Folder",
    initial: view.folder ?? "",
    confirm: "Move",
    placeholder: "Empty for the top level; / nests, as in Docker/Main",
  });
  if (folder === null) return;
  const trimmed = folder.trim();
  await moveToFolder(view, trimmed === "" ? null : trimmed);
}

export async function askNewFolder(parent: string | null): Promise<void> {
  const name = await useModal.getState().ask({
    kind: "text",
    title: "New Folder",
    label: parent === null ? "Folder" : `Folder in ${parent}`,
    initial: "",
    confirm: "Create",
  });
  const trimmed = name?.trim().replace(/^\/+|\/+$/g, "") ?? "";
  if (trimmed === "") return;
  const path = parent === null ? trimmed : `${parent}/${trimmed}`;
  useDatasources.getState().addFolder(path);
  useDatasources.getState().select({ kind: "folder", path });
}
