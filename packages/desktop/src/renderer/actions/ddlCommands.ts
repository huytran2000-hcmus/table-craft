import { sameRelation, useDdl, type DdlStore, type DdlTarget } from "@table-craft/desktop/renderer/state/ddl.js";
import { useTabs, type TabsStore } from "@table-craft/desktop/renderer/state/tabs.js";

const DDL_ID_PREFIX = "ddl-";
let ddlsOpened = 0;

/** Opens the relation's DDL tab in `stores`, or brings its open one forward (plan 010 decision 8). */
export async function openDdlIn(
  stores: { readonly tabs: TabsStore; readonly ddl: DdlStore },
  target: DdlTarget,
): Promise<void> {
  const existing = Object.entries(stores.ddl.getState().ddls).find(([, tab]) => sameRelation(tab, target))?.[0];
  if (existing !== undefined) {
    stores.tabs.getState().activate(existing);
    return;
  }
  const id = `${DDL_ID_PREFIX}${String(ddlsOpened++)}`;
  stores.tabs.getState().open({ id, kind: "ddl", title: target.relation });
  await stores.ddl.getState().open(id, target);
}

export function openDdl(target: DdlTarget): Promise<void> {
  return openDdlIn({ tabs: useTabs, ddl: useDdl }, target);
}
