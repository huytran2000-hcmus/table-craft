/** What a dialect needs the shared splitter and classifier to know (decision 023). */
export interface SqlDialectOptions {
  /** PostgreSQL `$tag$ … $tag$` strings. */
  readonly dollarQuotes?: boolean;
  /** MySQL `'\''`: a backslash escapes the next character in strings and double-quoted text. */
  readonly backslashEscapes?: boolean;
  /** The MySQL client's `DELIMITER //` line, which changes what ends a statement. */
  readonly delimiterCommand?: boolean;
  /** PostgreSQL block comments nest: a comment inside a comment needs its own close. */
  readonly nestedBlockComments?: boolean;
  /** MySQL `# comment`; PostgreSQL uses `#` as an operator. */
  readonly hashComments?: boolean;
  /** Keywords that open a body holding semicolons, closed by `END`, inside `CREATE TRIGGER`, `FUNCTION` and the like. */
  readonly blockKeywords?: readonly string[];
}

export type TokenKind = "word" | "quoted" | "string" | "comment" | "symbol" | "delimiter";

export interface Token {
  readonly kind: TokenKind;
  readonly from: number;
  readonly to: number;
}

export const DEFAULT_DELIMITER = ";";

const NEWLINE = "\n";
const FIRST_NON_ASCII = 0x80;
const DOLLAR_TAG = /\$(?:[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$/y;
/** PostgreSQL's `E'…'` string, where backslashes escape whatever the dialect's default. */
const ESCAPE_STRING_PREFIX = /^[eE]$/;

function isSpace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f" || char === "\v";
}

function isWordChar(char: string): boolean {
  const code = char.charCodeAt(0);
  if (code >= FIRST_NON_ASCII) return true;
  return (
    (char >= "a" && char <= "z") ||
    (char >= "A" && char <= "Z") ||
    (char >= "0" && char <= "9") ||
    char === "_" ||
    char === "$"
  );
}

/** A hand-written scanner: it knows quoting and comments, never grammar, so it cannot reject a statement. */
export class Lexer {
  position = 0;

  constructor(
    readonly text: string,
    readonly options: SqlDialectOptions,
  ) {}

  /** The next token after whitespace, or null at the end. `delimiter` ends a statement wherever it starts outside quotes. */
  next(delimiter: string = DEFAULT_DELIMITER): Token | null {
    const text = this.text;
    let at = this.position;
    while (at < text.length && isSpace(text.charAt(at))) at += 1;
    if (at >= text.length) {
      this.position = at;
      return null;
    }
    const char = text.charAt(at);
    const following = text.charAt(at + 1);
    let token: Token;
    if (char === "-" && following === "-") token = this.#lineComment(at);
    else if (char === "#" && this.options.hashComments === true) token = this.#lineComment(at);
    else if (char === "/" && following === "*") token = this.#blockComment(at);
    else if (text.startsWith(delimiter, at)) token = { kind: "delimiter", from: at, to: at + delimiter.length };
    else if (char === "'") token = this.#quoted(at, "'", "string", this.options.backslashEscapes === true);
    else if (char === '"') token = this.#quoted(at, '"', "quoted", this.options.backslashEscapes === true);
    else if (char === "`") token = this.#quoted(at, "`", "quoted", false);
    else if (char === "$" && this.options.dollarQuotes === true && this.#dollarTag(at) !== null) {
      token = this.#dollarQuoted(at, this.#dollarTag(at) ?? "");
    } else if (isWordChar(char)) token = this.#word(at, delimiter);
    else token = { kind: "symbol", from: at, to: at + 1 };
    this.position = token.to;
    return token;
  }

  #lineComment(from: number): Token {
    const end = this.text.indexOf(NEWLINE, from);
    return { kind: "comment", from, to: end < 0 ? this.text.length : end };
  }

  #blockComment(from: number): Token {
    const text = this.text;
    const nested = this.options.nestedBlockComments === true;
    let depth = 1;
    let at = from + 2;
    while (at < text.length && depth > 0) {
      if (text.startsWith("*/", at)) {
        depth -= 1;
        at += 2;
      } else if (nested && text.startsWith("/*", at)) {
        depth += 1;
        at += 2;
      } else {
        at += 1;
      }
    }
    return { kind: "comment", from, to: Math.min(at, text.length) };
  }

  /** A doubled quote is the quote itself; an unterminated one runs to the end of the text. */
  #quoted(from: number, quote: string, kind: TokenKind, backslashEscapes: boolean): Token {
    const text = this.text;
    let at = from + 1;
    while (at < text.length) {
      const char = text.charAt(at);
      if (backslashEscapes && char === "\\") {
        at += 2;
      } else if (char === quote) {
        if (text.charAt(at + 1) !== quote) return { kind, from, to: at + 1 };
        at += 2;
      } else {
        at += 1;
      }
    }
    return { kind, from, to: text.length };
  }

  #dollarTag(at: number): string | null {
    if (at > 0 && isWordChar(this.text.charAt(at - 1))) return null;
    DOLLAR_TAG.lastIndex = at;
    return DOLLAR_TAG.exec(this.text)?.[0] ?? null;
  }

  #dollarQuoted(from: number, tag: string): Token {
    const end = this.text.indexOf(tag, from + tag.length);
    return { kind: "string", from, to: end < 0 ? this.text.length : end + tag.length };
  }

  #word(from: number, delimiter: string): Token {
    const text = this.text;
    const customDelimiter = delimiter !== DEFAULT_DELIMITER;
    let at = from;
    while (at < text.length && isWordChar(text.charAt(at))) {
      if (customDelimiter && at > from && text.startsWith(delimiter, at)) break;
      at += 1;
    }
    if (text.charAt(at) === "'" && ESCAPE_STRING_PREFIX.test(text.slice(from, at))) {
      const string = this.#quoted(at, "'", "string", true);
      return { kind: "string", from, to: string.to };
    }
    return { kind: "word", from, to: at };
  }
}

/** Every token of `text` but comments, as one dialect reads it. */
export function significantTokens(text: string, options: SqlDialectOptions): Token[] {
  const lexer = new Lexer(text, options);
  const tokens: Token[] = [];
  for (let token = lexer.next(); token !== null; token = lexer.next()) {
    if (token.kind !== "comment") tokens.push(token);
  }
  return tokens;
}

export function wordOf(text: string, token: Token): string {
  return text.slice(token.from, token.to).toUpperCase();
}
