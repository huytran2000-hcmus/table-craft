/** A range of the console's text in UTF-16 offsets, as CodeMirror and the splitter count them. */
export interface TextSpan {
  readonly from: number;
  readonly to: number;
}

/** Run (⌘↵) resolves against the caret or selection; Run All (⇧⌘↵) takes every statement. */
export type RunScope = "caret" | "all";

export type RunTarget<S extends TextSpan> =
  | { readonly kind: "statements"; readonly statements: readonly S[] }
  /** The selection lies inside one statement: run the selected text alone. */
  | { readonly kind: "selection"; readonly from: number; readonly to: number }
  | { readonly kind: "nothing" };

const NOTHING = { kind: "nothing" } as const;

function atCaret<S extends TextSpan>(statements: readonly S[], caret: number): S | undefined {
  const containing = statements.find((statement) => statement.from <= caret && caret <= statement.to);
  if (containing !== undefined) return containing;
  const before = statements.filter((statement) => statement.to <= caret).at(-1);
  return before ?? statements[0];
}

/**
 * What Run executes (plan 006, decision 6). With no selection, the statement at the caret; in the
 * whitespace or comments between two, the one before; before the first, the first. A selection runs
 * every statement it touches, unless it lies inside one, when the selected text runs on its own.
 */
export function statementsToRun<S extends TextSpan>(
  statements: readonly S[],
  selection: TextSpan,
  scope: RunScope,
): RunTarget<S> {
  if (statements.length === 0) return NOTHING;
  if (scope === "all") return { kind: "statements", statements };
  if (selection.from === selection.to) {
    const statement = atCaret(statements, selection.from);
    return statement === undefined ? NOTHING : { kind: "statements", statements: [statement] };
  }
  const touched = statements.filter((statement) => statement.from < selection.to && statement.to > selection.from);
  const [only] = touched;
  if (only === undefined) return NOTHING;
  const inside = touched.length === 1 && selection.from >= only.from && selection.to <= only.to;
  const whole = selection.from === only.from && selection.to === only.to;
  if (inside && !whole) return { kind: "selection", from: selection.from, to: selection.to };
  return { kind: "statements", statements: touched };
}
