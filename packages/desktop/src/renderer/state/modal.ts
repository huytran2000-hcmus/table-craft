import { create } from "zustand";
import type { HistoryStatement } from "@table-craft/desktop/preload/bridge.js";

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
  | {
      readonly kind: "notice";
      readonly title: string;
      readonly message: string;
      readonly hint: string;
      /** A notice reports a failure unless it says it is `info`, like About. */
      readonly tone?: "info";
    }
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
    }
  | {
      /**
       * The SQL Generator (plan 010 decision 13): one statement kind at a time, previewed as
       * `generate` answers it; resolves `generatorAnswer(button, statement)`.
       */
      readonly kind: "generator";
      readonly title: string;
      readonly statements: readonly ModalChoice[];
      readonly initial: string;
      readonly highlight: string | null | undefined;
      readonly generate: (statement: string) => Promise<string>;
      readonly choices: readonly ModalChoice[];
    }
  | {
      /**
       * Query History (plan 011 decision 8): `search` answers as the field changes; resolves
       * `pickerAnswer(choice, sql)` for a `HISTORY_CHOICES` choice.
       */
      readonly kind: "history";
      readonly title: string;
      readonly search: (query: string) => Promise<readonly HistoryStatement[]>;
      readonly highlight: string | null | undefined;
      /** `Insert` into the console it was opened from, or `Open in Console`. */
      readonly restore: string;
      /** Epoch milliseconds the dialog opened at; entries from that day show only their time. */
      readonly now: number;
    }
  | {
      /** Open Closed Console (plan 011 decision 14): resolves `pickerAnswer(choice, name)` for a `CLOSED_CONSOLE_CHOICES` choice. */
      readonly kind: "closedConsoles";
      readonly title: string;
      readonly names: readonly string[];
      readonly read: (name: string) => Promise<string>;
      readonly highlight: string | null | undefined;
    }
  | {
      /** The Parameters dialog (plan 019 decision 6): resolves `parametersAnswer(values)`. */
      readonly kind: "parameters";
      readonly title: string;
      /** One row per name, in the order the statements first use them. */
      readonly names: readonly string[];
      readonly initial: Readonly<Record<string, string | null>>;
      /** The statements, each with the spans its placeholders occupy. */
      readonly statements: readonly MarkedStatement[];
    };

export interface MarkedStatement {
  readonly sql: string;
  readonly marks: readonly { readonly from: number; readonly to: number }[];
}

export const HISTORY_CHOICES = { restore: "restore", copy: "copy", clear: "clear" } as const;
export const CLOSED_CONSOLE_CHOICES = { open: "open", delete: "delete" } as const;

/**
 * Confirm and statements resolve "" when accepted; text resolves what was typed; choice resolves the chosen
 * id, generator its `generatorAnswer`, the pickers their `pickerAnswer`; every kind resolves null on cancel.
 */
export type ModalAnswer = string | null;

const GENERATOR_SEPARATOR = ":";

/** A generator's answer: the button chosen and the statement showing when it was. */
export function generatorAnswer(choice: string, statement: string): string {
  return `${choice}${GENERATOR_SEPARATOR}${statement}`;
}

/** A picker's answer: the button chosen and the item it acts on. */
export const pickerAnswer = generatorAnswer;

export function parseGeneratorAnswer(answer: string): { readonly choice: string; readonly statement: string } {
  const at = answer.indexOf(GENERATOR_SEPARATOR);
  return { choice: answer.slice(0, at), statement: answer.slice(at + GENERATOR_SEPARATOR.length) };
}

/** The radio group's arrow keys, as WAI-ARIA's radio group pattern moves them. */
const STEP_KEYS: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };

/** The generator statement an arrow key moves to from `current`, wrapping; null for any other key. */
export function steppedStatement(statements: readonly string[], current: string, key: string): string | null {
  const step = STEP_KEYS[key];
  if (step === undefined || statements.length === 0) return null;
  const at = Math.max(statements.indexOf(current), 0);
  return statements[(at + step + statements.length) % statements.length] ?? null;
}

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

export function parsePickerAnswer(answer: string): { readonly choice: string; readonly value: string } {
  const { choice, statement } = parseGeneratorAnswer(answer);
  return { choice, value: statement };
}
