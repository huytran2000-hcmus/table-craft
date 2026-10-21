import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { Button, CONTENT_CLASS, OVERLAY_CLASS, TextInput } from "@table-craft/desktop/renderer/dialogs/parts.js";
import { useModal, type ModalRequest } from "@table-craft/desktop/renderer/state/modal.js";
import { cn } from "@table-craft/desktop/renderer/ui/cn.js";

function Body({ request }: { readonly request: ModalRequest }) {
  const answer = useModal((state) => state.answer);
  const [text, setText] = useState(request.kind === "text" ? request.initial : "");

  return (
    <form
      className="flex flex-col gap-gap p-gap"
      onSubmit={(event) => {
        event.preventDefault();
        answer(request.kind === "text" ? text : "");
      }}
    >
      <Dialog.Title className="font-semibold">{request.title}</Dialog.Title>
      {request.kind === "text" ? (
        <label className="flex flex-col gap-1">
          <span className="text-ink-muted">{request.label}</span>
          <TextInput
            autoFocus
            aria-label={request.label}
            placeholder={request.placeholder}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
      ) : (
        <Dialog.Description className={cn(request.kind === "notice" && "text-danger")}>
          {request.message}
          {request.kind === "notice" ? <span className="block text-ink-muted">{request.hint}</span> : null}
        </Dialog.Description>
      )}
      <div className="flex justify-end gap-gap">
        {request.kind === "notice" ? null : <Button onClick={() => answer(null)}>Cancel</Button>}
        <Button
          type="submit"
          autoFocus={request.kind !== "text"}
          variant={request.kind === "confirm" && request.destructive === true ? "danger" : "primary"}
        >
          {request.kind === "notice" ? "OK" : request.confirm}
        </Button>
      </div>
    </form>
  );
}

/** Confirmations, one-line prompts and notices; actions ask through `useModal`. */
export function Modal() {
  const pending = useModal((state) => state.pending);
  return (
    <Dialog.Root
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) useModal.getState().answer(null);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY_CLASS} />
        <Dialog.Content aria-describedby={undefined} className={cn(CONTENT_CLASS, "w-96 max-w-[90vw]")}>
          {pending === null ? null : <Body request={pending.request} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
