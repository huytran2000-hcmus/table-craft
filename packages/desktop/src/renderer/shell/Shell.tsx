import { Group, Panel, type Layout } from "react-resizable-panels";
import { ACTION_IDS } from "@table-craft/desktop/renderer/actions/appActions.js";
import { DatabasePane } from "@table-craft/desktop/renderer/panes/DatabasePane.js";
import { ServicesPane } from "@table-craft/desktop/renderer/panes/ServicesPane.js";
import { EditorArea } from "@table-craft/desktop/renderer/shell/EditorArea.js";
import { MainToolbar } from "@table-craft/desktop/renderer/shell/MainToolbar.js";
import { StatusBar } from "@table-craft/desktop/renderer/shell/StatusBar.js";
import { Stripe } from "@table-craft/desktop/renderer/shell/Stripe.js";
import { ToolWindow } from "@table-craft/desktop/renderer/shell/ToolWindow.js";
import { useLayout, type ToolWindowId } from "@table-craft/desktop/renderer/state/layout.js";
import { Handle } from "@table-craft/desktop/renderer/ui/Handle.js";

const LEFT_STRIPE_TOP = [{ toolWindow: "database", actionId: ACTION_IDS.toggleDatabase }] as const;
const LEFT_STRIPE_BOTTOM = [{ toolWindow: "services", actionId: ACTION_IDS.toggleServices }] as const;
const MIN_TOOL_WINDOW_PERCENT = "10";
const MIN_EDITOR_PERCENT = "20";
/** The library's panels scroll by default; ours lay out their own scrolling regions. */
const PANEL_STYLE = { overflow: "hidden" } as const;

/** Writes a dragged size back to the layout store; sizes the library computes on its own are ignored. */
function persistSize(id: ToolWindowId) {
  return (layout: Layout, meta: { readonly isUserInteraction: boolean }) => {
    const size = layout[id];
    if (meta.isUserInteraction && size !== undefined) useLayout.getState().resize(id, size);
  };
}

const persistDatabase = persistSize("database");
const persistServices = persistSize("services");

/** DataGrip's frame: the main toolbar, stripes, Database left, editor tabs centre, Services bottom, status bar. */
export function Shell() {
  const visible = useLayout((state) => state.layout.visible);
  const sizes = useLayout((state) => state.layout.sizes);
  return (
    <main className="flex h-full flex-col bg-canvas text-ink">
      <MainToolbar />
      <div className="flex min-h-0 flex-1">
        <Stripe side="left" top={LEFT_STRIPE_TOP} bottom={LEFT_STRIPE_BOTTOM} />
        <Group orientation="vertical" className="min-w-0 flex-1" onLayoutChanged={persistServices}>
          <Panel id="main" minSize={MIN_EDITOR_PERCENT} style={PANEL_STYLE}>
            <Group orientation="horizontal" onLayoutChanged={persistDatabase}>
              {visible.database ? (
                <>
                  <Panel
                    id="database"
                    defaultSize={String(sizes.database)}
                    minSize={MIN_TOOL_WINDOW_PERCENT}
                    style={PANEL_STYLE}
                  >
                    <ToolWindow id="database" title="Database" toggleActionId={ACTION_IDS.toggleDatabase}>
                      <DatabasePane />
                    </ToolWindow>
                  </Panel>
                  <Handle axis="vertical" />
                </>
              ) : null}
              <Panel id="editor" minSize={MIN_EDITOR_PERCENT} style={PANEL_STYLE}>
                <EditorArea />
              </Panel>
            </Group>
          </Panel>
          {visible.services ? (
            <>
              <Handle axis="horizontal" />
              <Panel
                id="services"
                defaultSize={String(sizes.services)}
                minSize={MIN_TOOL_WINDOW_PERCENT}
                style={PANEL_STYLE}
              >
                <ToolWindow id="services" title="Services" toggleActionId={ACTION_IDS.toggleServices}>
                  <ServicesPane />
                </ToolWindow>
              </Panel>
            </>
          ) : null}
        </Group>
        <Stripe side="right" />
      </div>
      <StatusBar />
    </main>
  );
}
