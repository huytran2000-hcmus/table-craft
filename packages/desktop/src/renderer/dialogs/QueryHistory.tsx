import { useEffect, useState } from "react";
import type { HistoryStatement } from "@table-craft/desktop/preload/bridge.js";
import { firstLine, formatDuration, historyTime, rowsText } from "@table-craft/desktop/renderer/model/format.js";
import { toError } from "@table-craft/desktop/renderer/state/resultWindows.js";
import {
  HISTORY_CHOICES,
  pickerAnswer,
  useModal,
  type ModalRequest,
} from "@table-craft/desktop/renderer/state/modal.js";
import { ListPicker } from "@table-craft/desktop/renderer/ui/ListPicker.js";
import { OutcomeDot } from "@table-craft/desktop/renderer/ui/Outcome.js";
import { SqlView } from "@table-craft/desktop/renderer/ui/SqlView.js";

type HistoryRequest = Extract<ModalRequest, { kind: "history" }>;

interface Found {
  readonly query: string;
  readonly statements: readonly HistoryStatement[];
  readonly error: string | null;
}

const NO_STATEMENTS: readonly HistoryStatement[] = [];

function Entry({ statement, now }: { readonly statement: HistoryStatement; readonly now: number }) {
  return (
    <>
      <OutcomeDot outcome={statement.lastOutcome} />
      <span className="min-w-0 flex-1 truncate font-editor text-editor">{firstLine(statement.sql)}</span>
      {statement.runs > 1 ? <span className="shrink-0 text-ink-muted tabular-nums">×{statement.runs}</span> : null}
      {statement.lastRowCount === null ? null : (
        <span className="shrink-0 text-ink-muted tabular-nums">{rowsText(statement.lastRowCount)}</span>
      )}
      <span className="shrink-0 text-ink-muted tabular-nums">{formatDuration(statement.lastDurationMs)}</span>
      <span className="shrink-0 text-ink-muted tabular-nums">{historyTime(statement.lastStartedAt, now)}</span>
    </>
  );
}

/** The Query History dialog's body (plan 011 decisions 8 and 9): search, the list, the statement whole. */
export function QueryHistory({ request }: { readonly request: HistoryRequest }) {
  const answer = useModal((state) => state.answer);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found | null>(null);

  useEffect(() => {
    let current = true;
    request.search(query).then(
      (statements) => {
        if (current) setFound({ query, statements, error: null });
      },
      (cause: unknown) => {
        if (current) setFound({ query, statements: NO_STATEMENTS, error: toError(cause).message });
      },
    );
    return () => {
      current = false;
    };
  }, [request, query]);

  const statements = found?.statements ?? NO_STATEMENTS;
  const choose = (choice: string) => (statement: HistoryStatement | null) => {
    if (statement !== null) answer(pickerAnswer(choice, statement.sql));
  };
  return (
    <>
      <ListPicker
        title={request.title}
        searchLabel="Search history"
        query={query}
        onQuery={setQuery}
        items={statements}
        keyOf={(statement) => statement.sql}
        labelOf={(statement) => firstLine(statement.sql)}
        renderItem={(statement) => <Entry statement={statement} now={request.now} />}
        empty={found === null ? "" : query === "" ? "No statements yet." : "Nothing matches."}
        preview={(statement) => (
          <>
            {statement?.lastMessage == null ? null : (
              <p role="alert" data-testid="history-message" className="break-words text-danger">
                {statement.lastMessage}
              </p>
            )}
            <SqlView
              text={statement?.sql ?? ""}
              highlight={request.highlight}
              label="Statement"
              testId="history-preview"
              className="h-picker-list rounded border border-line bg-canvas"
            />
          </>
        )}
        onChoose={(statement) => answer(pickerAnswer(HISTORY_CHOICES.restore, statement.sql))}
        buttons={[
          {
            label: "Clear History…",
            variant: "danger",
            always: true,
            onClick: () => answer(pickerAnswer(HISTORY_CHOICES.clear, "")),
          },
          { label: "Copy", onClick: choose(HISTORY_CHOICES.copy) },
          { label: request.restore, variant: "primary", onClick: choose(HISTORY_CHOICES.restore) },
        ]}
        onClose={() => answer(null)}
      />
      {found?.error == null ? null : (
        <p role="alert" className="px-gap pb-gap break-words text-danger">
          {found.error}
        </p>
      )}
    </>
  );
}
