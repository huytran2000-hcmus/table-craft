import { useState, type KeyboardEvent } from "react";
import { useResults } from "@table-craft/desktop/renderer/state/results.js";

const INITIAL_SQL = "SELECT 1 AS one, 'two' AS two";
const RUN_KEY = "Enter";

/** A plain textarea until CodeMirror lands in its own plan. */
export function Console() {
  const [sql, setSql] = useState(INITIAL_SQL);
  const status = useResults((state) => state.status);
  const error = useResults((state) => state.error);
  const run = useResults((state) => state.run);
  const disabled = status !== "ready";

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== RUN_KEY || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    if (!disabled) void run(sql);
  }

  return (
    <section className="flex flex-col gap-gap border-b border-line bg-panel p-gap">
      <textarea
        aria-label="SQL console"
        className="h-console resize-y rounded border border-line bg-canvas p-cell font-editor text-editor text-ink outline-none focus:border-accent"
        spellCheck={false}
        value={sql}
        onChange={(event) => setSql(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="flex items-center gap-gap">
        <button
          type="button"
          className="h-row rounded bg-accent px-gap text-accent-ink disabled:opacity-50"
          disabled={disabled}
          onClick={() => void run(sql)}
        >
          Run
        </button>
        <span className="text-ink-muted">
          {status === "connecting" ? "Connecting…" : status === "running" ? "Running…" : ""}
        </span>
        {error === null ? null : (
          <span role="alert" className="text-danger">
            {error.message} {error.hint}
          </span>
        )}
      </div>
    </section>
  );
}
