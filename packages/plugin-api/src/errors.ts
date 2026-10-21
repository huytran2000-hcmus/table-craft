/** Failures the host tells apart; anything else a plugin throws is reported as `statementFailed`. */
export const PLUGIN_ERROR_CODES = ["cancelled", "connectionFailed", "statementFailed"] as const;

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
