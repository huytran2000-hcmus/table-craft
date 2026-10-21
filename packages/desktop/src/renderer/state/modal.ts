import { create } from "zustand";

/** A question that blocks the window until answered. */
export type ModalRequest =
  | {
      readonly kind: "confirm";
      readonly title: string;
      readonly message: string;
      readonly confirm: string;
      readonly destructive?: boolean;
    }
  | {
      readonly kind: "text";
      readonly title: string;
      readonly label: string;
      readonly initial: string;
      readonly confirm: string;
      readonly placeholder?: string;
    }
  | { readonly kind: "notice"; readonly title: string; readonly message: string; readonly hint: string };

/** Confirm resolves "" when accepted; text resolves what was typed; every kind resolves null on cancel. */
export type ModalAnswer = string | null;

interface Pending {
  readonly request: ModalRequest;
  readonly resolve: (answer: ModalAnswer) => void;
}

export interface ModalState {
  readonly pending: Pending | null;
  readonly ask: (request: ModalRequest) => Promise<ModalAnswer>;
  readonly answer: (answer: ModalAnswer) => void;
}

export const useModal = create<ModalState>()((set, get) => ({
  pending: null,
  ask(request) {
    get().pending?.resolve(null);
    return new Promise((resolve) => set({ pending: { request, resolve } }));
  },
  answer(answer) {
    const pending = get().pending;
    set({ pending: null });
    pending?.resolve(answer);
  },
}));
