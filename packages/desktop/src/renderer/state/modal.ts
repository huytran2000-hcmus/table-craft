import { create } from "zustand";

/** A line of a confirmation's list: a statement and why it is listed, say. */
export interface ModalItem {
  readonly label: string;
  readonly detail: string;
}

/** A button of a `choice`; its `id` is the answer. */
export interface ModalChoice {
  readonly id: string;
  readonly label: string;
  readonly variant?: "primary" | "secondary" | "danger";
}

/** A question that blocks the window until answered. */
export type ModalRequest =
  | {
      readonly kind: "confirm";
      readonly title: string;
      readonly message: string;
      readonly items?: readonly ModalItem[];
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
  | { readonly kind: "notice"; readonly title: string; readonly message: string; readonly hint: string }
  | {
      /** SQL shown whole, one statement a block, before it runs: the table editor's Preview. */
      readonly kind: "statements";
      readonly title: string;
      readonly message: string;
      readonly statements: readonly string[];
      readonly confirm: string;
    }
  | {
      readonly kind: "choice";
      readonly title: string;
      readonly message: string;
      readonly items?: readonly ModalItem[];
      /** Shown before Cancel, the first one focused. */
      readonly choices: readonly ModalChoice[];
    };

/**
 * Confirm and statements resolve "" when accepted; text resolves what was typed; choice resolves the chosen id;
 * every kind resolves null on cancel.
 */
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
