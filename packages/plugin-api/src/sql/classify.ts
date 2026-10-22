import type { StatementClass, StatementKind } from "@table-craft/plugin-api";
import { significantTokens, type SqlDialectOptions } from "./tokens.js";
import { explainPrefix, mainVerb, words, type Word } from "./words.js";

const KINDS: ReadonlyMap<string, StatementKind> = new Map<string, StatementKind>([
  ...["SELECT", "SHOW", "EXPLAIN", "DESCRIBE", "DESC", "VALUES", "TABLE"].map((word) => [word, "read"] as const),
  ...["INSERT", "UPDATE", "DELETE", "MERGE", "REPLACE", "UPSERT", "COPY", "LOAD"].map(
    (word) => [word, "write"] as const,
  ),
  ...["CREATE", "ALTER", "DROP", "TRUNCATE", "RENAME", "COMMENT"].map((word) => [word, "ddl"] as const),
  ...["BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT", "RELEASE", "END", "ABORT"].map(
    (word) => [word, "transaction"] as const,
  ),
]);

const START = "START";
const TRANSACTION = "TRANSACTION";
const WHERE = "WHERE";
const LIMIT = "LIMIT";
const WITH = "WITH";
/** Prefixes the explained statement's destructive reason, so the confirmation says why it matters. */
export const EXPLAIN_ANALYZE_REASON_PREFIX = "EXPLAIN ANALYZE runs it: ";

function hasTopLevel(list: readonly Word[], from: number, word: string): boolean {
  return list.some((entry, at) => at > from && entry.depth === 0 && entry.word === word);
}

function destructiveReason(list: readonly Word[], verbAt: number): string | null {
  const verb = list[verbAt]?.word;
  switch (verb) {
    case "DELETE":
      if (hasTopLevel(list, verbAt, WHERE)) return null;
      return hasTopLevel(list, verbAt, LIMIT)
        ? "DELETE without WHERE (LIMIT does not choose the rows)"
        : "DELETE without WHERE";
    case "UPDATE":
      return hasTopLevel(list, verbAt, WHERE) ? null : "UPDATE without WHERE";
    case "DROP": {
      const object = list[verbAt + 1]?.word;
      return object === undefined ? "DROP" : `DROP ${object}`;
    }
    case "TRUNCATE":
      return "TRUNCATE";
    default:
      return null;
  }
}

/**
 * A token-level classifier plugins may build `SqlLanguage.classify` on (decision 023). The first
 * keyword picks the kind; `UPDATE` or `DELETE` without a top-level `WHERE`, `DROP` and `TRUNCATE`
 * are destructive (decision 011). `EXPLAIN` is a read unless it analyses, which runs the statement,
 * so `EXPLAIN ANALYZE` takes the statement's kind and destructive reason (decision 031). It never
 * parses, so it never rejects a statement.
 */
export function classifyTokens(sql: string, options: SqlDialectOptions = {}): StatementClass {
  return classifyWords(words(sql, significantTokens(sql, options)));
}

function classifyWords(list: readonly Word[]): StatementClass {
  const first = list[0]?.word;
  if (first === undefined) return { kind: "other", destructive: null };
  if (first === START) {
    return { kind: list[1]?.word === TRANSACTION ? "transaction" : "other", destructive: null };
  }
  const explain = explainPrefix(list);
  if (explain !== null) {
    if (!explain.analyze) return { kind: "read", destructive: null };
    const inner = classifyWords(list.slice(explain.statementAt));
    return {
      kind: inner.kind,
      destructive: inner.destructive === null ? null : `${EXPLAIN_ANALYZE_REASON_PREFIX}${inner.destructive}`,
    };
  }
  const verbAt = mainVerb(list);
  const verb = list[verbAt]?.word ?? first;
  const kind = first === WITH && verbAt === 0 ? "read" : (KINDS.get(verb) ?? "other");
  return { kind, destructive: destructiveReason(list, verbAt) };
}

export type TransactionEffect = "begin" | "end";

const ENDS = new Set(["COMMIT", "END", "ABORT"]);
const ROLLBACK = "ROLLBACK";
const TO = "TO";
const PREPARE = "PREPARE";

/**
 * Whether a statement opens or ends a transaction, for plugins that track `Transactions.open` in
 * auto mode: `BEGIN` and `START TRANSACTION` open one; `COMMIT`, `ROLLBACK` (not `ROLLBACK TO`),
 * `END`, `ABORT` and `PREPARE TRANSACTION` end it. Null for anything else.
 */
export function transactionEffect(sql: string, options: SqlDialectOptions = {}): TransactionEffect | null {
  const list = words(sql, significantTokens(sql, options)).map((entry) => entry.word);
  const [first, second] = list;
  if (first === "BEGIN" || (first === START && second === TRANSACTION)) return "begin";
  if (first !== undefined && ENDS.has(first)) return "end";
  if (first === PREPARE && second === TRANSACTION) return "end";
  if (first === ROLLBACK) return list.includes(TO) ? null : "end";
  return null;
}
