import { unquote, type Identifier } from "./scope.js";
import { significantTokens, wordOf, type SqlDialectOptions, type Token } from "./tokens.js";

/** One select-list entry of a simple SELECT: `*`, `x.*`, a column reference, or anything else. */
export type SimpleSelectItem =
  | { readonly kind: "star"; readonly qualifier: Identifier | null }
  | { readonly kind: "column"; readonly qualifier: readonly Identifier[]; readonly name: Identifier }
  | { readonly kind: "expression" };

/** A `SELECT items FROM [qualifier.]name [alias]` with nothing but filters, order and limits after it. */
export interface SimpleSelect {
  readonly qualifier: readonly Identifier[];
  readonly name: Identifier;
  readonly alias: Identifier | null;
  readonly items: readonly SimpleSelectItem[];
}

/** Why a statement is not a simple SELECT, for the console's toolbar (plan 026). */
export const SELECT_READ_ONLY_REASONS = {
  notSelect: "the statement is not a simple SELECT",
  with: "the statement has a WITH clause",
  distinct: "the result is DISTINCT",
  joins: "the result joins two or more tables",
  aggregates: "the result aggregates rows",
  windows: "the result uses window functions",
  combines: "the result combines queries",
  derived: "the result reads a subquery or function, not a table",
  noTable: "the result reads no table",
} as const;

const SELECT = "SELECT";
const FROM = "FROM";
const AS = "AS";
const STAR = "*";
const DOT = ".";
const COMMA = ",";
const OPEN = "(";
const CLOSE = ")";
const OVER = "OVER";
const ONLY = "ONLY";
const ON = "ON";
const NOT = "NOT";
const WITH = "WITH";
const DISTINCT = new Set(["DISTINCT", "DISTINCTROW", "UNIQUE"]);
const SELECT_ALL = "ALL";
/** What may follow the table at the top level. */
const TAIL_CLAUSES = new Set(["WHERE", "ORDER", "LIMIT", "OFFSET", "FETCH"]);
const JOINS = new Set(["JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "NATURAL", "STRAIGHT_JOIN", "OUTER"]);
const GROUPING = new Set(["GROUP", "HAVING"]);
const SET_OPERATIONS = new Set(["UNION", "INTERSECT", "EXCEPT", "MINUS"]);
/** Top-level words after the table that make the statement more than a read of its rows. */
const OTHER_TAIL = new Set([
  "WINDOW",
  "INTO",
  "FOR",
  "LOCK",
  "QUALIFY",
  "TABLESAMPLE",
  "PARTITION",
  "USE",
  "FORCE",
  "IGNORE",
  "INDEXED",
  "NOT",
]);
const AGGREGATES = new Set([
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "ARRAY_AGG",
  "STRING_AGG",
  "GROUP_CONCAT",
  "JSON_AGG",
  "JSONB_AGG",
  "JSON_OBJECT_AGG",
  "JSONB_OBJECT_AGG",
  "JSON_ARRAYAGG",
  "JSON_OBJECTAGG",
  "JSON_GROUP_ARRAY",
  "JSON_GROUP_OBJECT",
  "BOOL_AND",
  "BOOL_OR",
  "EVERY",
  "BIT_AND",
  "BIT_OR",
  "BIT_XOR",
  "STDDEV",
  "STDDEV_POP",
  "STDDEV_SAMP",
  "VARIANCE",
  "VAR_POP",
  "VAR_SAMP",
  "TOTAL",
  "XMLAGG",
  "PERCENTILE_CONT",
  "PERCENTILE_DISC",
  "MODE",
]);
const NOT_A_NAME = /^[0-9$]/;

type Parsed = SimpleSelect | { readonly readOnly: string };

/** The text and kind checks the parser needs over one statement's tokens. */
class Reader {
  constructor(
    readonly text: string,
    readonly tokens: readonly Token[],
  ) {}

  word(token: Token | undefined): string | null {
    return token?.kind === "word" ? wordOf(this.text, token) : null;
  }

  symbol(token: Token | undefined): string | null {
    return token?.kind === "symbol" ? this.text.slice(token.from, token.to) : null;
  }

  identifier(token: Token | undefined): Identifier | null {
    if (token === undefined) return null;
    const raw = this.text.slice(token.from, token.to);
    if (token.kind === "quoted") return { name: unquote(raw), quoted: true, from: token.from, to: token.to };
    if (token.kind === "word" && !NOT_A_NAME.test(raw))
      return { name: raw, quoted: false, from: token.from, to: token.to };
    return null;
  }

  /** Each token's parenthesis depth, and whether it sits inside a parenthesised subquery. */
  depths(): { readonly depth: number[]; readonly inSubquery: boolean[] } {
    const depth: number[] = [];
    const inSubquery: boolean[] = [];
    const subqueries: boolean[] = [];
    this.tokens.forEach((token, index) => {
      const symbol = this.symbol(token);
      if (symbol === CLOSE) subqueries.pop();
      depth.push(subqueries.length);
      inSubquery.push(subqueries.some(Boolean));
      if (symbol === OPEN) subqueries.push(this.word(this.tokens[index + 1]) === SELECT);
    });
    return { depth, inSubquery };
  }
}

/** A dotted name `a.b.c` from `at`: its parts and the index after it, or null when `at` holds no name. */
function dottedName(reader: Reader, at: number): { readonly parts: Identifier[]; readonly next: number } | null {
  const first = reader.identifier(reader.tokens[at]);
  if (first === null) return null;
  const parts = [first];
  let next = at + 1;
  while (reader.symbol(reader.tokens[next]) === DOT) {
    const part = reader.identifier(reader.tokens[next + 1]);
    if (part === null) break;
    parts.push(part);
    next += 2;
  }
  return { parts, next };
}

function selectItem(reader: Reader, from: number, to: number): SimpleSelectItem {
  const tokens = reader.tokens;
  if (to - from === 1 && reader.symbol(tokens[from]) === STAR) return { kind: "star", qualifier: null };
  const name = dottedName(reader, from);
  if (name === null) return { kind: "expression" };
  if (name.next === to - 2 && reader.symbol(tokens[name.next]) === DOT && reader.symbol(tokens[to - 1]) === STAR) {
    return { kind: "star", qualifier: name.parts.at(-1) ?? null };
  }
  const last = name.parts.at(-1);
  if (last === undefined) return { kind: "expression" };
  const column = (): SimpleSelectItem => ({ kind: "column", qualifier: name.parts.slice(0, -1), name: last });
  if (name.next === to) return column();
  const aliasAt = reader.word(tokens[name.next]) === AS ? name.next + 1 : name.next;
  if (aliasAt === to - 1 && (tokens[aliasAt]?.kind === "string" || reader.identifier(tokens[aliasAt]) !== null)) {
    return column();
  }
  return { kind: "expression" };
}

/** Why the select list makes the result something other than the table's rows, or null. */
function selectListRefusal(reader: Reader, from: number, to: number, inSubquery: readonly boolean[]): string | null {
  const tokens = reader.tokens;
  let aggregate = false;
  for (let at = from; at < to; at += 1) {
    if (inSubquery[at] === true) continue;
    const word = reader.word(tokens[at]);
    if (word === OVER) return SELECT_READ_ONLY_REASONS.windows;
    if (word !== null && AGGREGATES.has(word) && reader.symbol(tokens[at + 1]) === OPEN) aggregate = true;
  }
  return aggregate ? SELECT_READ_ONLY_REASONS.aggregates : null;
}

/** Why the words after the table refuse editing, or null when they only filter, order and limit. */
function tailRefusal(reader: Reader, from: number, depth: readonly number[]): string | null {
  const tokens = reader.tokens;
  const first = reader.word(tokens[from]);
  if (from < tokens.length && (first === null || !TAIL_CLAUSES.has(first))) {
    if (reader.symbol(tokens[from]) === COMMA || (first !== null && JOINS.has(first))) {
      return SELECT_READ_ONLY_REASONS.joins;
    }
    if (first !== null && GROUPING.has(first)) return SELECT_READ_ONLY_REASONS.aggregates;
    if (first !== null && SET_OPERATIONS.has(first)) return SELECT_READ_ONLY_REASONS.combines;
    return SELECT_READ_ONLY_REASONS.notSelect;
  }
  for (let at = from; at < tokens.length; at += 1) {
    if (depth[at] !== 0) continue;
    const word = reader.word(tokens[at]);
    if (word === null) continue;
    if (GROUPING.has(word)) return SELECT_READ_ONLY_REASONS.aggregates;
    if (SET_OPERATIONS.has(word)) return SELECT_READ_ONLY_REASONS.combines;
    if (JOINS.has(word) || (word === ON && at > from)) return SELECT_READ_ONLY_REASONS.joins;
    if (OTHER_TAIL.has(word) && word !== NOT) return SELECT_READ_ONLY_REASONS.notSelect;
  }
  return null;
}

/**
 * `sql`, one statement, read as a single-table SELECT (plan 026). Strict on purpose: whatever
 * it does not recognise is read-only, because a wrong "editable" writes to the wrong rows.
 */
export function parseSimpleSelect(sql: string, dialect: SqlDialectOptions): Parsed {
  const tokens = significantTokens(sql, dialect).filter((token) => token.kind !== "delimiter");
  const reader = new Reader(sql, tokens);
  const head = reader.word(tokens[0]);
  if (head === WITH) return { readOnly: SELECT_READ_ONLY_REASONS.with };
  if (reader.symbol(tokens[0]) === OPEN) return { readOnly: SELECT_READ_ONLY_REASONS.combines };
  if (head !== SELECT) return { readOnly: SELECT_READ_ONLY_REASONS.notSelect };
  const { depth, inSubquery } = reader.depths();
  let at = 1;
  const modifier = reader.word(tokens[at]);
  if (modifier !== null && DISTINCT.has(modifier)) return { readOnly: SELECT_READ_ONLY_REASONS.distinct };
  if (modifier === SELECT_ALL) at += 1;
  const fromAt = tokens.findIndex((token, index) => index >= at && depth[index] === 0 && reader.word(token) === FROM);
  if (fromAt < 0) return { readOnly: SELECT_READ_ONLY_REASONS.noTable };
  const refusal = selectListRefusal(reader, at, fromAt, inSubquery);
  if (refusal !== null) return { readOnly: refusal };
  const items: SimpleSelectItem[] = [];
  let itemFrom = at;
  for (let index = at; index <= fromAt; index += 1) {
    if (index === fromAt || (depth[index] === 0 && reader.symbol(tokens[index]) === COMMA)) {
      if (index === itemFrom) return { readOnly: SELECT_READ_ONLY_REASONS.notSelect };
      items.push(selectItem(reader, itemFrom, index));
      itemFrom = index + 1;
    }
  }
  if (reader.symbol(tokens[fromAt + 1]) === OPEN) return { readOnly: SELECT_READ_ONLY_REASONS.derived };
  if (reader.word(tokens[fromAt + 1]) === ONLY) return { readOnly: SELECT_READ_ONLY_REASONS.notSelect };
  const table = dottedName(reader, fromAt + 1);
  if (table === null) return { readOnly: SELECT_READ_ONLY_REASONS.notSelect };
  if (reader.symbol(tokens[table.next]) === OPEN) return { readOnly: SELECT_READ_ONLY_REASONS.derived };
  let next = table.next;
  let alias: Identifier | null = null;
  const afterTable = reader.word(tokens[next]);
  if (afterTable === AS) {
    alias = reader.identifier(tokens[next + 1]);
    if (alias === null) return { readOnly: SELECT_READ_ONLY_REASONS.notSelect };
    next += 2;
  } else if (tokens[next] !== undefined && (afterTable === null || !isClauseWord(afterTable))) {
    alias = reader.identifier(tokens[next]);
    if (alias !== null) next += 1;
  }
  const tail = tailRefusal(reader, next, depth);
  if (tail !== null) return { readOnly: tail };
  const name = table.parts.at(-1);
  if (name === undefined) return { readOnly: SELECT_READ_ONLY_REASONS.notSelect };
  return { qualifier: table.parts.slice(0, -1), name, alias, items };
}

function isClauseWord(word: string): boolean {
  return (
    TAIL_CLAUSES.has(word) ||
    JOINS.has(word) ||
    GROUPING.has(word) ||
    SET_OPERATIONS.has(word) ||
    OTHER_TAIL.has(word) ||
    word === ON ||
    word === ONLY
  );
}
