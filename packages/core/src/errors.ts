export type CoreErrorCode =
  "unknownHandle" | "unknownPlugin" | "pluginUnavailable" | "invalidConfig" | "invalidRequest";

/** A failure the user can act on: `hint` says what to do next. */
export class CoreError extends Error {
  override readonly name = "CoreError";

  constructor(
    readonly code: CoreErrorCode,
    message: string,
    readonly hint: string,
  ) {
    super(message);
  }
}
