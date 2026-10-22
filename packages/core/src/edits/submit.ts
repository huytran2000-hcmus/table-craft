import { isPluginError, type Row, type Session } from "@table-craft/plugin-api";
import { CoreError, EditRejectedError } from "@table-craft/core/errors.js";

export interface SubmittedEdits {
  readonly statements: readonly string[];
  /** Summed over every statement; each one touched exactly one row. */
  readonly rowsAffected: number;
}

const EXPECTED_ROWS = 1;
const REJECTED_HINT = "Nothing was saved. Reload the table to see its current rows, then edit again.";

async function drain(rows: AsyncIterable<Row>): Promise<void> {
  for await (const row of rows) void row;
}

function messageOf(error: unknown): string {
  if (isPluginError(error) || error instanceof Error) return error.message;
  return String(error);
}

function countMessage(index: number, affected: number | null): string {
  const counted = affected === null ? "an unknown number of rows" : `${String(affected)} rows`;
  return `Statement ${String(index + 1)} affected ${counted} instead of exactly one; the row may have changed or gone.`;
}

/**
 * Runs `statements` in one transaction on `session` and commits (decision 026). Every statement must
 * affect exactly one row; any other count or any error rolls the whole batch back and rejects with
 * `EditRejectedError` naming the statement. The session ends in `auto` mode either way.
 */
export async function submitEdits(session: Session, statements: readonly string[]): Promise<SubmittedEdits> {
  const transactions = session.transactions;
  if (transactions === undefined) {
    throw new CoreError(
      "invalidRequest",
      "This datasource's plugin cannot run a transaction.",
      "Edit the table with statements in a console.",
    );
  }
  if (transactions.open) {
    throw new CoreError(
      "invalidRequest",
      "The editor's session already holds an open transaction.",
      "Reload the table, then submit again.",
    );
  }
  if (statements.length === 0) return { statements, rowsAffected: 0 };
  await transactions.setMode("manual");
  let rowsAffected = 0;
  let index = 0;
  try {
    for (; index < statements.length; index += 1) {
      const statement = statements[index] ?? "";
      const result = await session.execute(statement);
      await drain(result.rows);
      if (result.rowsAffected !== EXPECTED_ROWS) {
        throw new EditRejectedError(countMessage(index, result.rowsAffected), REJECTED_HINT, index, statement);
      }
      rowsAffected += result.rowsAffected;
    }
    await transactions.commit();
  } catch (error) {
    await transactions.rollback().catch(() => undefined);
    await transactions.setMode("auto").catch(() => undefined);
    if (error instanceof EditRejectedError) throw error;
    const statement = statements[index] ?? "";
    const failed = index < statements.length ? `Statement ${String(index + 1)} failed: ` : "Commit failed: ";
    throw new EditRejectedError(failed + messageOf(error), REJECTED_HINT, index, statement);
  }
  await transactions.setMode("auto");
  return { statements, rowsAffected };
}
