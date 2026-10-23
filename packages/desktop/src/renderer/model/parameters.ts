import type { ClassifiedStatement, ParameterValue, StatementParameter } from "@table-craft/desktop/engine/protocol.js";

const POSITIONAL_PREFIX = "?";

/** The values a run binds, by the name the Parameters dialog shows. */
export type ParameterValues = Readonly<Record<string, ParameterValue>>;

/** One statement of a prompted run and the dialog name each of its placeholders answers to. */
export interface PromptedStatement {
  readonly statement: ClassifiedStatement;
  /** The statement's parameter name (`:id`, `$1`, `?2`) to the dialog's (`:id`, `$1`, `?5`). */
  readonly names: ReadonlyMap<string, string>;
}

export interface ParameterPrompt {
  /** The dialog's rows, in the order they first appear; empty when nothing needs a value. */
  readonly names: readonly string[];
  readonly statements: readonly PromptedStatement[];
}

function dialogName(parameter: StatementParameter, positionalBefore: number): string {
  if (parameter.style !== "positional") return parameter.name;
  return `${POSITIONAL_PREFIX}${String(positionalBefore + Number(parameter.name.slice(POSITIONAL_PREFIX.length)))}`;
}

/**
 * What a run asks for (plan 019 decision 10): named and numbered parameters are one row per name
 * across the script; each `?` is its own row, numbered across the script, so the third `?` of a
 * run whose first statement holds two is `?3` in the dialog and `?1` in its statement.
 */
export function parameterPrompt(statements: readonly ClassifiedStatement[]): ParameterPrompt {
  const names: string[] = [];
  let positionalBefore = 0;
  const prompted = statements.map((statement) => {
    const own = new Map<string, string>();
    for (const parameter of statement.parameters) {
      const name = dialogName(parameter, positionalBefore);
      own.set(parameter.name, name);
      if (!names.includes(name)) names.push(name);
    }
    positionalBefore += new Set(
      statement.parameters.filter((parameter) => parameter.style === "positional").map((parameter) => parameter.name),
    ).size;
    return { statement, names: own };
  });
  return { names, statements: prompted };
}

/** The values one statement binds, by its own parameter names; undefined when it has none. */
export function valuesFor(prompted: PromptedStatement, values: ParameterValues): ParameterValues | undefined {
  if (prompted.names.size === 0) return undefined;
  const own: Record<string, ParameterValue> = {};
  for (const [name, asked] of prompted.names) {
    const value = values[asked];
    if (value !== undefined) own[name] = value;
  }
  return own;
}

/** The value the dialog shows for `name`: empty when there is none yet, null when it is NULL. */
export function shownValue(values: ParameterValues, name: string): ParameterValue {
  const value = values[name];
  return value === undefined ? "" : value;
}

/** The dialog's answer as the modal store carries it: one string, or null on cancel. */
export function parametersAnswer(values: ParameterValues): string {
  return JSON.stringify(values);
}

export function parseParametersAnswer(answer: string): ParameterValues {
  const parsed: unknown = JSON.parse(answer);
  const values: Record<string, ParameterValue> = {};
  if (typeof parsed !== "object" || parsed === null) return values;
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string" || value === null) values[name] = value;
  }
  return values;
}
