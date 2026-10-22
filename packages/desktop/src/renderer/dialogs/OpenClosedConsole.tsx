import { useEffect, useState } from "react";
import { toError } from "@table-craft/desktop/renderer/state/resultWindows.js";
import {
  CLOSED_CONSOLE_CHOICES,
  pickerAnswer,
  useModal,
  type ModalRequest,
} from "@table-craft/desktop/renderer/state/modal.js";
import { ConsoleIcon } from "@table-craft/desktop/renderer/ui/icons.js";
import { ListPicker } from "@table-craft/desktop/renderer/ui/ListPicker.js";
import { SqlView } from "@table-craft/desktop/renderer/ui/SqlView.js";

type ClosedConsolesRequest = Extract<ModalRequest, { kind: "closedConsoles" }>;

interface Preview {
  readonly name: string;
  readonly text: string | null;
  readonly error: string | null;
}

function ConsolePreview({ request, name }: { readonly request: ClosedConsolesRequest; readonly name: string | null }) {
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    if (name === null) return;
    let current = true;
    request.read(name).then(
      (text) => {
        if (current) setPreview({ name, text, error: null });
      },
      (cause: unknown) => {
        if (current) setPreview({ name, text: null, error: toError(cause).message });
      },
    );
    return () => {
      current = false;
    };
  }, [request, name]);

  const shown = preview !== null && preview.name === name ? preview : null;
  return (
    <>
      {shown?.error == null ? null : (
        <p role="alert" className="break-words text-danger">
          {shown.error}
        </p>
      )}
      <SqlView
        text={shown?.text ?? ""}
        highlight={request.highlight}
        label="Console text"
        testId="closed-console-preview"
        className="h-picker-list rounded border border-line bg-canvas"
      />
    </>
  );
}

/** Open Closed Console's body (plan 011 decision 14): the datasource's console files no tab has open. */
export function OpenClosedConsole({ request }: { readonly request: ClosedConsolesRequest }) {
  const answer = useModal((state) => state.answer);
  const choose = (choice: string) => (name: string | null) => {
    if (name !== null) answer(pickerAnswer(choice, name));
  };
  return (
    <ListPicker
      title={request.title}
      searchLabel="Closed consoles"
      items={request.names}
      keyOf={(name) => name}
      labelOf={(name) => name}
      renderItem={(name) => (
        <>
          <ConsoleIcon aria-hidden className="size-icon shrink-0 text-ink-muted" />
          <span className="truncate">{name}</span>
        </>
      )}
      empty="No closed consoles."
      preview={(name) => <ConsolePreview request={request} name={name} />}
      onChoose={(name) => answer(pickerAnswer(CLOSED_CONSOLE_CHOICES.open, name))}
      buttons={[
        { label: "Delete…", variant: "danger", onClick: choose(CLOSED_CONSOLE_CHOICES.delete) },
        { label: "Open", variant: "primary", onClick: choose(CLOSED_CONSOLE_CHOICES.open) },
      ]}
      onClose={() => answer(null)}
    />
  );
}
