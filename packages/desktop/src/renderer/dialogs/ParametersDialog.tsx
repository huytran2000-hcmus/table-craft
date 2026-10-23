import * as Dialog from "@radix-ui/react-dialog";
import { useId, useState, type ReactNode } from "react";
import { Button, TextInput } from "@table-craft/desktop/renderer/dialogs/parts.js";
import { parametersAnswer, shownValue } from "@table-craft/desktop/renderer/model/parameters.js";
import { useModal, type MarkedStatement, type ModalRequest } from "@table-craft/desktop/renderer/state/modal.js";

type ParametersRequest = Extract<ModalRequest, { kind: "parameters" }>;

const NULL_LABEL = "NULL";

function Marked({ statement }: { readonly statement: MarkedStatement }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [index, mark] of statement.marks.entries()) {
    parts.push(statement.sql.slice(at, mark.from));
    parts.push(
      <mark key={index} className="rounded bg-search-match text-ink">
        {statement.sql.slice(mark.from, mark.to)}
      </mark>,
    );
    at = mark.to;
  }
  parts.push(statement.sql.slice(at));
  return <>{parts}</>;
}

function ParameterRow({
  name,
  value,
  onChange,
  autoFocus,
}: {
  readonly name: string;
  readonly value: string | null;
  readonly onChange: (value: string | null) => void;
  readonly autoFocus: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(value ?? "");
  return (
    <>
      <label htmlFor={id} className="flex h-row items-center justify-end font-editor text-editor">
        {name}
      </label>
      <div className="flex min-w-0 items-center gap-gap">
        <TextInput
          id={id}
          autoFocus={autoFocus}
          className="min-w-0 flex-1 font-editor text-editor"
          aria-label={`Value of ${name}`}
          disabled={value === null}
          value={value === null ? "" : text}
          onChange={(event) => {
            setText(event.target.value);
            onChange(event.target.value);
          }}
        />
        <label className="flex shrink-0 items-center gap-cell">
          <input
            type="checkbox"
            aria-label={`${name} is NULL`}
            checked={value === null}
            onChange={(event) => onChange(event.target.checked ? null : text)}
          />
          {NULL_LABEL}
        </label>
      </div>
    </>
  );
}

/** Asks for the values of a run's parameters (plan 019 decision 6); Enter runs, Esc cancels. */
export function ParametersDialog({ request }: { readonly request: ParametersRequest }) {
  const answer = useModal((state) => state.answer);
  const [values, setValues] = useState<Readonly<Record<string, string | null>>>(() =>
    Object.fromEntries(request.names.map((name) => [name, shownValue(request.initial, name)])),
  );
  return (
    <form
      className="flex flex-col gap-gap p-gap"
      onSubmit={(event) => {
        event.preventDefault();
        answer(parametersAnswer(values));
      }}
    >
      <Dialog.Title className="font-semibold">{request.title}</Dialog.Title>
      <div role="group" aria-label="Values" className="grid grid-cols-[auto_1fr] gap-x-gap gap-y-1">
        {request.names.map((name, index) => (
          <ParameterRow
            key={name}
            name={name}
            autoFocus={index === 0}
            value={shownValue(values, name)}
            onChange={(value) => setValues((current) => ({ ...current, [name]: value }))}
          />
        ))}
      </div>
      <ol
        aria-label="Statements"
        className="flex max-h-[40vh] flex-col gap-1 overflow-auto rounded border border-line bg-canvas p-cell"
      >
        {request.statements.map((statement, index) => (
          <li key={index}>
            <code className="font-editor text-editor break-words whitespace-pre-wrap select-text">
              <Marked statement={statement} />
            </code>
          </li>
        ))}
      </ol>
      <div className="flex justify-end gap-gap">
        <Button onClick={() => answer(null)}>Cancel</Button>
        <Button type="submit" variant="primary">
          Run
        </Button>
      </div>
    </form>
  );
}
