import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";
import type { Column, WireValue } from "@table-craft/desktop/engine/protocol.js";
import { EDITOR_THEME } from "@table-craft/desktop/renderer/console/editorTheme.js";
import { NULL_TEXT, panelValue } from "@table-craft/desktop/renderer/grid/format.js";
import { prettyJson } from "@table-craft/desktop/renderer/model/prettyJson.js";

function JsonView({ text }: { readonly text: string }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  useEffect(() => {
    if (host.current === null) return;
    const created = new EditorView({
      parent: host.current,
      state: EditorState.create({
        extensions: [
          EDITOR_THEME,
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.lineWrapping,
        ],
      }),
    });
    view.current = created;
    return () => {
      created.destroy();
      view.current = null;
    };
  }, []);
  useEffect(() => {
    const current = view.current;
    if (current === null) return;
    const doc = prettyJson(text);
    if (current.state.doc.toString() !== doc) {
      current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: doc } });
    }
  }, [text]);
  return <div ref={host} data-testid="value-json" className="min-h-0 flex-1 overflow-hidden" />;
}

/**
 * The focused cell's whole value beside the rows (plan 007 decision 15). It sits outside the grid's
 * focus region, so ⌘C and ⌘A here copy and select its text, not cells.
 */
export function ValuePanel({
  column,
  value,
}: {
  readonly column: Column | null;
  /** `undefined` while the cell's window is loading, or with no cell focused. */
  readonly value: WireValue | undefined;
}) {
  const shown = value === undefined ? null : panelValue(value);
  return (
    <aside
      aria-label="Value"
      className="flex w-value-panel min-w-0 shrink-0 flex-col border-l border-line bg-panel font-grid text-grid"
    >
      <div className="flex h-row shrink-0 items-center gap-gap border-b border-line px-cell text-ui">
        <span className="truncate text-ink">{column?.name ?? "Value"}</span>
        {column?.type == null ? null : <span className="truncate text-ink-muted">{column.type}</span>}
      </div>
      {shown === null ? (
        <p className="p-cell text-ink-muted">{column === null ? "Select a cell to see its value." : "Loading…"}</p>
      ) : shown.kind === "null" ? (
        <p className="p-cell text-grid-null italic">{NULL_TEXT}</p>
      ) : shown.kind === "json" ? (
        <JsonView text={shown.text} />
      ) : shown.kind === "bytes" ? (
        <div className="min-h-0 flex-1 overflow-auto p-cell">
          <pre data-testid="value-bytes" className="whitespace-pre text-ink">
            {shown.hex}
          </pre>
          <p className="pt-gap text-ink-muted">{shown.note}</p>
        </div>
      ) : (
        <pre
          data-testid="value-text"
          className="min-h-0 flex-1 overflow-auto p-cell break-words whitespace-pre-wrap text-ink select-text"
        >
          {shown.text}
        </pre>
      )}
    </aside>
  );
}
