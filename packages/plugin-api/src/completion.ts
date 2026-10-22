import type { ForeignKey, Namespace, Relation } from "./catalog.js";

/** What a completion item names; the console draws each with the Database pane's glyph for it. */
export const COMPLETION_KINDS = [
  "namespace",
  "table",
  "view",
  "column",
  "alias",
  "cte",
  "join",
  "function",
  "keyword",
] as const;

export type CompletionKind = (typeof COMPLETION_KINDS)[number];

export interface CompletionItem {
  /** What the popup shows and the editor filters on. */
  readonly label: string;
  readonly kind: CompletionKind;
  /** A column's type, a relation's namespace or a join's foreign key; null when there is nothing to add. */
  readonly detail: string | null;
  /** The text accepting the item inserts over the result's `from`…`to`, quoted where the dialect needs it. */
  readonly apply: string;
  /** Orders items the typed prefix matches equally well; higher comes first, within -99…99. */
  readonly boost: number;
}

/** The table a clause body is written against, such as the table editor's WHERE bar (plan 009 decision 9). */
export interface CompletionScope {
  readonly path: readonly string[];
  readonly relation: string;
}

export interface CompletionRequest {
  readonly text: string;
  /** The caret, in UTF-16 offsets into `text` (decision 023). */
  readonly offset: number;
  /** When present, `text` is a clause body with `relation` in scope, not a whole script. */
  readonly scope?: CompletionScope;
}

export interface CompletionResult {
  /** The span accepting an item replaces: the word typed before the caret. */
  readonly from: number;
  readonly to: number;
  readonly items: readonly CompletionItem[];
  /**
   * A regular expression source the editor may keep filtering these items with while the typed word
   * still matches it, without asking again; null to ask again on every keystroke.
   */
  readonly validFor: string | null;
}

export interface ResolveRequest {
  readonly text: string;
  readonly offset: number;
}

/** Where the name at the caret was declared (plan 009 decision 10). */
export type Declaration =
  | { readonly kind: "alias" | "cte"; readonly from: number; readonly to: number }
  | { readonly kind: "relation"; readonly path: readonly string[]; readonly relation: string }
  | { readonly kind: "column"; readonly path: readonly string[]; readonly relation: string; readonly column: string };

/** A foreign key in `path`.`relation` that targets the relation asked about. */
export interface IncomingForeignKey {
  readonly path: readonly string[];
  readonly relation: string;
  readonly foreignKey: ForeignKey;
}

/**
 * What completion may read about the datasource (decision 028): the engine's catalog cache. It
 * never touches a console's session, and answers with what it has once a describe runs too long.
 */
export interface CompletionCatalog {
  /** Where unqualified names resolve; null when the datasource reports no current namespace. */
  readonly current: readonly string[] | null;
  namespaces(): Promise<readonly Namespace[]>;
  /** Every relation in `path`, described on demand; empty when the describe fails or runs too long. */
  relations(path: readonly string[]): Promise<readonly Relation[]>;
  /** Foreign keys targeting `path`.`relation` in every namespace described so far. */
  referencing(path: readonly string[], relation: string): Promise<readonly IncomingForeignKey[]>;
}
