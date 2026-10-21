import { useEffect, useRef } from "react";
import type { OutputEntry, OutputTone } from "@table-craft/desktop/renderer/state/consoles.js";
import { cn } from "@table-craft/desktop/renderer/ui/cn.js";

const TONE_CLASS: Readonly<Record<OutputTone, string>> = {
  info: "text-ink",
  success: "text-ink",
  warning: "text-warning",
  error: "text-danger",
};

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** The console's Output tab (plan 006 decision 11): one line per statement run, newest at the bottom. */
export function OutputLog({ entries }: { readonly entries: readonly OutputEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const last = entries[entries.length - 1]?.id;

  useEffect(() => {
    const element = scrollRef.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [last]);

  if (entries.length === 0) {
    return <div className="flex-1 p-gap text-ink-muted">Run a statement to see its result.</div>;
  }
  return (
    <div
      ref={scrollRef}
      role="log"
      aria-label="Output"
      className="min-h-0 flex-1 overflow-auto px-gap py-1 font-editor text-editor"
    >
      {entries.map((entry) => (
        <div key={entry.id} data-tone={entry.tone} className="flex items-baseline gap-gap leading-(--spacing-row)">
          <span className="shrink-0 text-ink-muted">[{TIME_FORMAT.format(entry.at)}]</span>
          {entry.sql === "" ? null : <span className="max-w-1/2 shrink-0 truncate text-ink-muted">{entry.sql}</span>}
          <span className={cn("min-w-0", TONE_CLASS[entry.tone])}>
            {entry.message}
            {entry.hint === null ? null : <span className="text-ink-muted"> {entry.hint}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
