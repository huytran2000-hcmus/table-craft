import { unquote, type Identifier } from "./scope.js";
import { significantTokens, wordOf, type SqlDialectOptions, type Token } from "./tokens.js";

/** Where a session-namespace statement points unqualified names. */
export interface NamespaceTarget {
  readonly kind: "database" | "schema";
  /** In the order the statement lists them; empty for `DEFAULT` and `RESET`, which restore the server's setting. */
  readonly candidates: readonly Identifier[];
}

const USE = "USE";
const SET = "SET";
const RESET = "RESET";
const SET_SCOPES = new Set(["SESSION", "LOCAL"]);
const SEARCH_PATH = "SEARCH_PATH";
const SCHEMA = "SCHEMA";
const ALL = "ALL";
const ASSIGNMENTS = new Set(["TO", "="]);
const DEFAULT = "DEFAULT";
const LIST_SEPARATOR = ",";
const STRING_QUOTE = "'";

function identifier(text: string, token: Token | undefined): Identifier | null {
  if (token === undefined) return null;
  const raw = text.slice(token.from, token.to);
  const { from, to } = token;
  if (token.kind === "word") return { name: raw, quoted: false, from, to };
  if (token.kind === "quoted") return { name: unquote(raw), quoted: true, from, to };
  // search_path quotes each element (GUC_LIST_QUOTE), so a string element is an exact name.
  if (token.kind === "string" && raw.startsWith(STRING_QUOTE)) return { name: unquote(raw), quoted: true, from, to };
  return null;
}

function wordAt(text: string, tokens: readonly Token[], at: number): string | undefined {
  const token = tokens[at];
  if (token === undefined) return undefined;
  return token.kind === "word" || token.kind === "symbol" ? wordOf(text, token) : undefined;
}

function useTarget(text: string, tokens: readonly Token[]): NamespaceTarget | null {
  if (tokens.length !== 2 || wordAt(text, tokens, 0) !== USE) return null;
  const name = identifier(text, tokens[1]);
  return name === null || tokens[1]?.kind === "string" ? null : { kind: "database", candidates: [name] };
}

/** `a, "b", 'c'` from `at` to the end; null when it is not such a list. */
function list(text: string, tokens: readonly Token[], at: number): Identifier[] | null {
  const names: Identifier[] = [];
  for (let index = at; index < tokens.length; index += 2) {
    const name = identifier(text, tokens[index]);
    if (name === null) return null;
    names.push(name);
    const separator = tokens[index + 1];
    if (separator !== undefined && wordAt(text, tokens, index + 1) !== LIST_SEPARATOR) return null;
    if (separator !== undefined && index + 2 >= tokens.length) return null;
  }
  return names.length === 0 ? null : names;
}

function searchPathTarget(text: string, tokens: readonly Token[]): NamespaceTarget | null {
  const first = wordAt(text, tokens, 0);
  if (first === RESET) {
    const what = wordAt(text, tokens, 1);
    return tokens.length === 2 && (what === SEARCH_PATH || what === ALL) ? { kind: "schema", candidates: [] } : null;
  }
  if (first !== SET) return null;
  let at = SET_SCOPES.has(wordAt(text, tokens, 1) ?? "") ? 2 : 1;
  const parameter = wordAt(text, tokens, at);
  at += 1;
  if (parameter === SEARCH_PATH) {
    if (!ASSIGNMENTS.has(wordAt(text, tokens, at) ?? "")) return null;
    at += 1;
  } else if (parameter !== SCHEMA) {
    return null;
  }
  if (tokens.length === at + 1 && tokens[at]?.kind === "word" && wordAt(text, tokens, at) === DEFAULT) {
    return { kind: "schema", candidates: [] };
  }
  const names = list(text, tokens, at);
  if (names === null || (parameter === SCHEMA && names.length !== 1)) return null;
  return { kind: "schema", candidates: names };
}

/**
 * Whether `sql` is a statement that moves the session's current namespace in a dialect declaring
 * `namespaceStatements`, and where it points. It never asks the server, so a named namespace may
 * not exist; the session's `currentNamespace()` is the truth once the statement ran.
 */
export function namespaceTarget(sql: string, dialect: SqlDialectOptions): NamespaceTarget | null {
  const forms = dialect.namespaceStatements ?? [];
  if (forms.length === 0) return null;
  const tokens = significantTokens(sql, dialect).filter((token) => token.kind !== "delimiter");
  for (const form of forms) {
    const target = form === "use" ? useTarget(sql, tokens) : searchPathTarget(sql, tokens);
    if (target !== null) return target;
  }
  return null;
}
