import type { TransactionMode } from "@table-craft/desktop/engine/protocol.js";
import { ACTION_IDS } from "@table-craft/desktop/renderer/actions/appActions.js";
import { invoke, useActionEnabled } from "@table-craft/desktop/renderer/actions/index.js";
import { ActionButton } from "@table-craft/desktop/renderer/console/ActionButton.js";
import type { ConsoleSession } from "@table-craft/desktop/renderer/state/consoles.js";

const MODE_LABEL: Readonly<Record<TransactionMode, string>> = { auto: "Tx: Auto", manual: "Tx: Manual" };

/**
 * The transaction controls (plan 006 decision 14): the mode, Commit and Rollback, enabled only
 * while a transaction is open, and a badge saying one is.
 */
export function TxControls({ session }: { readonly session: Pick<ConsoleSession, "txMode" | "transactionOpen"> }) {
  const canToggle = useActionEnabled(ACTION_IDS.toggleTransactionMode);
  return (
    <div className="flex shrink-0 items-center gap-gap">
      <select
        aria-label="Transaction mode"
        title="Auto commits every statement; Manual keeps a transaction open until Commit or Rollback."
        className="h-row rounded border border-line bg-panel px-1 text-ink disabled:opacity-50"
        value={session.txMode}
        disabled={!canToggle}
        onChange={(event) => {
          if (event.target.value !== session.txMode) invoke(ACTION_IDS.toggleTransactionMode);
        }}
      >
        {(["auto", "manual"] as const).map((mode) => (
          <option key={mode} value={mode}>
            {MODE_LABEL[mode]}
          </option>
        ))}
      </select>
      <ActionButton actionId={ACTION_IDS.commit} />
      <ActionButton actionId={ACTION_IDS.rollback} />
      {session.transactionOpen ? (
        <span role="status" className="rounded bg-warning px-1 text-canvas">
          transaction open
        </span>
      ) : null}
    </div>
  );
}
