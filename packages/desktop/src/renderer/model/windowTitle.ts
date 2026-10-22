export const APP_TITLE = "table-craft";
const SEPARATOR = " — ";

/** The active tab as the toolbar shows it: `console [pg]`, or the tab alone when it has no datasource. */
export function tabCaption(tab: { readonly title: string } | null, datasourceName: string | null): string | null {
  if (tab === null) return null;
  return datasourceName === null ? tab.title : `${tab.title} [${datasourceName}]`;
}

/** What Mission Control, the Dock menu and the taskbar call the window: `console [pg] — table-craft`. */
export function windowTitle(tab: { readonly title: string } | null, datasourceName: string | null): string {
  const caption = tabCaption(tab, datasourceName);
  return caption === null ? APP_TITLE : `${caption}${SEPARATOR}${APP_TITLE}`;
}
