import type { LogRecord } from "@table-craft/desktop/log/record.js";

export const REDACTED = "[redacted]";

/** A remembered secret shorter than this would shred ordinary words wherever it appears. */
export const MIN_REMEMBERED_SECRET_LENGTH = 4;

/** How deep a record's fields are walked; deeper values are replaced whole. */
const MAX_FIELD_DEPTH = 8;

const SECRET_KEY = /(pass(word|phrase|wd)?|secret|token|api_?key|credentials?|private_?key)$/i;
/** The scheme is bounded: an unbounded one backtracks quadratically over a long run of letters. */
const URL_USERINFO = /\b([a-z][a-z0-9+.-]{0,31}:\/\/)[^/\s:@]+(?::[^/\s@]*)?@/gi;
const URL_MARKER = "://";

export interface Redactor {
  /** Every later record has this value replaced wherever it appears. */
  remember(secret: string): void;
  text(value: string): string;
  value(value: unknown): unknown;
  record(record: LogRecord): LogRecord;
}

export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Defence in depth behind "never log a secret" (plan 017 decision 5, decision 020): key names that
 * look secret, URL userinfo, and every secret value main has handled this session.
 */
export function createRedactor(): Redactor {
  const secrets = new Set<string>();
  let pattern: RegExp | null = null;

  const text = (value: string): string => {
    const stripped = value.includes(URL_MARKER) ? value.replace(URL_USERINFO, "$1") : value;
    return pattern === null ? stripped : stripped.replace(pattern, REDACTED);
  };

  const walk = (value: unknown, depth: number): unknown => {
    if (typeof value === "string") return text(value);
    if (typeof value !== "object" || value === null) return value;
    if (depth >= MAX_FIELD_DEPTH) return REDACTED;
    if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1));
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        isSecretKey(key) && item !== null && item !== undefined && item !== "" ? REDACTED : walk(item, depth + 1),
      ]),
    );
  };

  return {
    remember(secret) {
      if (secret.length < MIN_REMEMBERED_SECRET_LENGTH || secrets.has(secret)) return;
      secrets.add(secret);
      const longestFirst = [...secrets].sort((left, right) => right.length - left.length);
      pattern = new RegExp(longestFirst.map(escapeRegExp).join("|"), "g");
    },
    text,
    value: (value) => walk(value, 0),
    record: (record) => walk(record, 0) as LogRecord,
  };
}
