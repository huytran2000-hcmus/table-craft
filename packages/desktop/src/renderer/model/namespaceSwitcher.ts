import type { CurrentNamespace, Namespace } from "@table-craft/desktop/engine/protocol.js";
import type { ConsoleSession, ConsoleStatus } from "@table-craft/desktop/renderer/state/consoles.js";

/** One row of the switcher's list. */
export interface SwitcherRow {
  readonly namespace: Namespace;
  /** Whether the console's session is in it now. */
  readonly current: boolean;
}

/** The switcher's list: the user's namespaces in catalog order, then the system ones under a divider. */
export interface SwitcherGroups {
  readonly regular: readonly SwitcherRow[];
  readonly system: readonly SwitcherRow[];
}

const BLOCKED_BY_STATUS: Partial<Record<ConsoleStatus, string>> = {
  connecting: "The console is connecting.",
  running: "A statement is running; wait for it or cancel it.",
  confirming: "The console is waiting for an answer.",
};
const FETCHING = "A result is fetching rows; wait for it or cancel it.";

/** `targets` narrowed to the names containing `query`, ignoring case, and split into the two groups. */
export function switcherGroups(
  targets: readonly Namespace[],
  current: CurrentNamespace,
  query: string,
): SwitcherGroups {
  const needle = query.trim().toLowerCase();
  const here = current?.join(".") ?? null;
  const rows = targets
    .filter((namespace) => namespace.name.toLowerCase().includes(needle))
    .map((namespace) => ({ namespace, current: namespace.path.join(".") === here }));
  return { regular: rows.filter((row) => !row.namespace.system), system: rows.filter((row) => row.namespace.system) };
}

/** Why the console cannot switch now, or null when it can: the session is busy with something else. */
export function switchBlocked(session: Pick<ConsoleSession, "status" | "results">): string | null {
  const byStatus = BLOCKED_BY_STATUS[session.status];
  if (byStatus !== undefined) return byStatus;
  const fetching = session.results.some((result) => result.kind === "rows" && result.fetching !== null);
  return fetching ? FETCHING : null;
}
