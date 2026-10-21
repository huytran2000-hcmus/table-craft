import type { StatementSpan } from "@table-craft/plugin-api";
import { DEFAULT_DELIMITER, Lexer, wordOf, type SqlDialectOptions, type Token } from "./tokens.js";

const DELIMITER_COMMAND = "DELIMITER";
/** A body only opens inside a statement that defines a routine, so a column called `begin` stays a column. */
const BODY_OWNERS = new Set(["TRIGGER", "FUNCTION", "PROCEDURE", "EVENT"]);
const CREATE = "CREATE";
const CASE = "CASE";
const END = "END";
/** `END IF`, `END LOOP` and the like close a construct the splitter never counted as opened. */
const UNCOUNTED_END_TARGETS = new Set(["IF", "LOOP", "WHILE", "REPEAT"]);
const LINE_BREAK = /\r?\n/;

interface Statement {
  from: number;
  to: number;
  words: number;
  /** The statement is a `CREATE` that has named a routine, so a block keyword opens its body. */
  definesRoutine: boolean;
  isCreate: boolean;
  depth: number;
  /** An `END` was seen inside a body; the next token decides whether it closes one. */
  pendingEnd: boolean;
}

function freshStatement(from: number): Statement {
  return { from, to: from, words: 0, isCreate: false, definesRoutine: false, depth: 0, pendingEnd: false };
}

/**
 * A configurable splitter plugins may build `SqlLanguage.split` on (decision 023). It tokenizes
 * strings, quoted identifiers, comments, dollar quotes, `DELIMITER` lines and `BEGIN … END`
 * bodies, and drops statements that hold nothing but comments.
 */
export function sqlSplitter(options: SqlDialectOptions = {}): (text: string) => StatementSpan[] {
  const blockKeywords = new Set((options.blockKeywords ?? []).map((keyword) => keyword.toUpperCase()));

  return (text) => {
    const spans: StatementSpan[] = [];
    const lexer = new Lexer(text, options);
    let delimiter = DEFAULT_DELIMITER;
    let statement: Statement | null = null;

    const flush = (): void => {
      if (statement !== null)
        spans.push({ from: statement.from, to: statement.to, sql: text.slice(statement.from, statement.to) });
      statement = null;
    };

    const readDelimiterCommand = (token: Token): void => {
      const rest = text.slice(token.to);
      const line = rest.split(LINE_BREAK, 1)[0] ?? "";
      const value = line.trim().split(/\s+/, 1)[0] ?? "";
      if (value !== "") delimiter = value;
      lexer.position = token.to + line.length;
    };

    const resolvePendingEnd = (current: Statement, token: Token): boolean => {
      if (!current.pendingEnd) return false;
      current.pendingEnd = false;
      const word = token.kind === "word" ? wordOf(text, token) : "";
      if (UNCOUNTED_END_TARGETS.has(word)) return true;
      current.depth = Math.max(0, current.depth - 1);
      return word === CASE;
    };

    for (let token = lexer.next(delimiter); token !== null; token = lexer.next(delimiter)) {
      if (token.kind === "comment") continue;
      if (token.kind === "delimiter") {
        const current: Statement | null = statement;
        if (current !== null) resolvePendingEnd(current, token);
        if (current === null || current.depth === 0 || delimiter !== DEFAULT_DELIMITER) flush();
        else current.to = token.to;
        continue;
      }
      if (statement === null) {
        if (options.delimiterCommand === true && token.kind === "word" && wordOf(text, token) === DELIMITER_COMMAND) {
          readDelimiterCommand(token);
          continue;
        }
        statement = freshStatement(token.from);
      }
      const current: Statement = statement;
      current.to = token.to;
      const consumed = resolvePendingEnd(current, token);
      if (token.kind !== "word" || consumed) continue;
      const word = wordOf(text, token);
      current.words += 1;
      if (current.words === 1) {
        current.isCreate = word === CREATE;
        continue;
      }
      if (current.depth > 0) {
        if (word === END) current.pendingEnd = true;
        else if (blockKeywords.has(word) || word === CASE) current.depth += 1;
      } else if (current.definesRoutine && blockKeywords.has(word)) {
        current.depth = 1;
      } else if (current.isCreate && BODY_OWNERS.has(word)) {
        current.definesRoutine = true;
      }
    }
    flush();
    return spans;
  };
}
