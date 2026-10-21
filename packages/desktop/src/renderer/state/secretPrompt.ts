import { create } from "zustand";
import type { SecretRequest } from "@table-craft/desktop/renderer/state/datasources.js";

interface Pending {
  readonly request: SecretRequest;
  readonly resolve: (values: Readonly<Record<string, string>> | null) => void;
}

export interface SecretPromptState {
  readonly pending: Pending | null;
  /** Shows the prompt; resolves with what was typed, or null when cancelled. */
  readonly ask: (request: SecretRequest) => Promise<Readonly<Record<string, string>> | null>;
  readonly answer: (values: Readonly<Record<string, string>> | null) => void;
}

export const useSecretPrompt = create<SecretPromptState>()((set, get) => ({
  pending: null,
  ask(request) {
    // One prompt at a time: a second connect while one is open cancels the first.
    get().pending?.resolve(null);
    return new Promise((resolve) => set({ pending: { request, resolve } }));
  },
  answer(values) {
    const pending = get().pending;
    set({ pending: null });
    pending?.resolve(values);
  },
}));
