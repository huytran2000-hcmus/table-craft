import { sql } from "@codemirror/lang-sql";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { dialectOf } from "@table-craft/desktop/renderer/console/Editor.js";
import { EDITOR_THEME } from "@table-craft/desktop/renderer/console/editorTheme.js";
import { cn } from "@table-craft/desktop/renderer/ui/cn.js";

function language(highlight: string | null | undefined) {
  return sql({ dialect: dialectOf(highlight), upperCaseKeywords: true });
}

/**
 * SQL shown read-only and highlighted in the datasource's dialect: a DDL tab's definition, the SQL
 * Generator's preview (plan 010). Text can still be selected and copied.
 */
export function SqlView({
  text,
  highlight,
  label,
  testId,
  className,
}: {
  readonly text: string;
  readonly highlight: string | null | undefined;
  readonly label: string;
  readonly testId?: string;
  readonly className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const dialect = useRef(new Compartment());
  const latest = useRef({ text, highlight });
  useEffect(() => {
    latest.current = { text, highlight };
  });
  useEffect(() => {
    if (host.current === null) return;
    const created = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: latest.current.text,
        extensions: [
          lineNumbers(),
          dialect.current.of(language(latest.current.highlight)),
          EDITOR_THEME,
          EditorState.readOnly.of(true),
          EditorView.contentAttributes.of({ "aria-label": label }),
        ],
      }),
    });
    view.current = created;
    return () => {
      created.destroy();
      view.current = null;
    };
  }, [label]);
  useEffect(() => {
    view.current?.dispatch({ effects: dialect.current.reconfigure(language(highlight)) });
  }, [highlight]);
  useEffect(() => {
    const current = view.current;
    if (current === null || current.state.doc.toString() === text) return;
    current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: text } });
  }, [text]);
  return <div ref={host} data-testid={testId} className={cn("min-h-0 overflow-hidden", className)} />;
}
