export type CoreErrorCode =
  "unknownHandle" | "unknownPlugin" | "pluginUnavailable" | "invalidConfig" | "invalidRequest" | "editRejected";

/** A failure the user can act on: `hint` says what to do next. */
export class CoreError extends Error {
  override readonly name: string = "CoreError";

  constructor(
    readonly code: CoreErrorCode,
    message: string,
    readonly hint: string,
  ) {
    super(message);
  }
}

/** A Submit the database refused, or that touched the wrong number of rows; nothing was kept (decision 026). */
export class EditRejectedError extends CoreError {
  override readonly name = "EditRejectedError";

  constructor(
    message: string,
    hint: string,
    /** 0-based, into the statements Submit ran. */
    readonly statementIndex: number,
    readonly statement: string,
  ) {
    super("editRejected", message, hint);
  }
}
