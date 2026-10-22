import { wordOf, type Token } from "./tokens.js";

export interface Word {
  readonly word: string;
  /** Parentheses around it; 0 is the statement's own level. */
  readonly depth: number;
}

const OPEN_PAREN = "(";
const CLOSE_PAREN = ")";
const WITH = "WITH";
const MAIN_VERBS = new Set(["SELECT", "INSERT", "UPDATE", "DELETE", "MERGE"]);

/** The statement's words, upper-cased, each with its parenthesis depth. */
export function words(sql: string, tokens: readonly Token[]): Word[] {
  const found: Word[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.kind === "symbol") {
      const char = sql.charAt(token.from);
      if (char === OPEN_PAREN) depth += 1;
      else if (char === CLOSE_PAREN) depth = Math.max(0, depth - 1);
    } else if (token.kind === "word") {
      found.push({ word: wordOf(sql, token), depth });
    }
  }
  return found;
}

/** The verb that decides what a `WITH …` statement does: the first one outside the CTEs' parentheses. */
export function mainVerb(list: readonly Word[]): number {
  if (list[0]?.word !== WITH) return 0;
  const index = list.findIndex((entry, at) => at > 0 && entry.depth === 0 && MAIN_VERBS.has(entry.word));
  return index < 0 ? 0 : index;
}

/** MySQL reads `DESCRIBE` and `DESC` before a statement as `EXPLAIN`, `ANALYZE` included. */
export const EXPLAIN_VERBS: ReadonlySet<string> = new Set(["EXPLAIN", "DESCRIBE", "DESC"]);
const ANALYZE_WORDS = new Set(["ANALYZE", "ANALYSE"]);
/** PostgreSQL's boolean option values that turn `ANALYZE` off inside `EXPLAIN ( … )`. */
const FALSE_WORDS = new Set(["FALSE", "OFF", "0"]);
/** Words between `EXPLAIN` and the statement that take no value. */
const FLAG_WORDS = new Set(["VERBOSE", "QUERY", "PLAN", "EXTENDED", "PARTITIONS"]);
const FORMAT = "FORMAT";

export interface ExplainPrefix {
  /** Whether the statement runs: `ANALYZE` bare, or on inside the parenthesised options. */
  readonly analyze: boolean;
  /** The index in the word list where the explained statement starts. */
  readonly statementAt: number;
}

/**
 * Reads `EXPLAIN [ANALYZE | ANALYSE] [VERBOSE] [( … )] [FORMAT = x] [QUERY PLAN] <statement>`
 * (decision 031); null when the list does not start with `EXPLAIN`, `DESCRIBE` or `DESC`.
 */
export function explainPrefix(list: readonly Word[]): ExplainPrefix | null {
  const first = list[0]?.word;
  if (first === undefined || !EXPLAIN_VERBS.has(first)) return null;
  let analyze = false;
  let at = 1;
  for (let entry = list[at]; entry !== undefined; entry = list[at]) {
    if (entry.depth > 0) {
      if (ANALYZE_WORDS.has(entry.word)) {
        const value = list[at + 1];
        analyze = !(value !== undefined && value.depth > 0 && FALSE_WORDS.has(value.word));
      }
      at += 1;
    } else if (ANALYZE_WORDS.has(entry.word)) {
      analyze = true;
      at += 1;
    } else if (entry.word === FORMAT) {
      at += 2;
    } else if (FLAG_WORDS.has(entry.word)) {
      at += 1;
    } else {
      break;
    }
  }
  return { analyze, statementAt: Math.min(at, list.length) };
}
