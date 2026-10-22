/** Failures the host tells apart; anything else a plugin throws is reported as `statementFailed`. */
export const PLUGIN_ERROR_CODES = [
  "cancelled",
  "connectionFailed",
  "statementFailed",
  "introspectionFailed",
  "definitionNotFound",
  /** `Session.explain` refused the statement; the message says why and what to explain instead. */
  "explainUnsupported",
] as const;

export type PluginErrorCode = (typeof PLUGIN_ERROR_CODES)[number];

/** What a plugin throws when the host should react to the kind of failure, not just show it. */
export class PluginError extends Error {
  override readonly name = "PluginError";

  constructor(
    readonly code: PluginErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/**
 * Structural, because every bundled plugin carries its own copy of this module, so `instanceof`
 * fails for an error thrown by a plugin and caught by the host.
 */
export function isPluginError(error: unknown): error is PluginError {
  if (!(error instanceof Error) || error.name !== "PluginError") return false;
  const code: unknown = (error as { code?: unknown }).code;
  return PLUGIN_ERROR_CODES.some((known) => known === code);
}

/**
 * `Introspector.definition` asked for a relation the database does not have, usually one dropped
 * or renamed since the catalog was read (decision 029). Coded `definitionNotFound`, so the host
 * recognises it with `isPluginError` across plugin bundles.
 */
export class DefinitionNotFoundError extends PluginError {
  constructor(
    readonly path: readonly string[],
    readonly relation: string,
    options?: ErrorOptions,
  ) {
    super(
      "definitionNotFound",
      `There is no relation ${relation} in ${path.join(".")}; synchronize the data source to see what it holds now.`,
      options,
    );
  }
}
