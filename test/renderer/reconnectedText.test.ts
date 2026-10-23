import { describe, expect, it } from "vitest";
import { STATEMENT_CANCELLED_MESSAGE } from "@table-craft/desktop/engine/protocol.js";
import { cancelledText, reconnectedText } from "@table-craft/desktop/renderer/model/format.js";

describe("reconnected text", () => {
  it("givenResultNotClosed_whenFormatted_thenSaysTheResultCouldNotBeClosed", () => {
    expect(reconnectedText({ namespace: null, namespaceLost: false, reason: "resultNotClosed" })).toBe(
      "The previous result could not be closed in time; reconnected.",
    );
  });

  it("givenResultNotClosedOffTheOpeningNamespace_whenFormatted_thenAlsoSaysWhereTheSessionStarts", () => {
    expect(reconnectedText({ namespace: ["shop"], namespaceLost: true, reason: "resultNotClosed" })).toBe(
      "The previous result could not be closed in time; reconnected. The new session starts in shop; the USE or search path set earlier no longer applies.",
    );
  });

  it("givenNoReason_whenFormatted_thenSaysTheConnectionHadBeenLost", () => {
    expect(reconnectedText({ namespace: null, namespaceLost: false })).toBe(
      "Reconnected: the connection had been lost.",
    );
  });
});

describe("cancelled text", () => {
  const hint = "Run it again when ready.";

  it("givenPlainCancel_whenFormatted_thenJustCancelled", () => {
    expect(cancelledText({ code: "cancelled", message: STATEMENT_CANCELLED_MESSAGE, hint })).toBe("Cancelled");
  });

  it("givenCancelThatResetTheSession_whenFormatted_thenSaysWhatTheCancelDid", () => {
    const message = "The statement was cancelled by resetting the session.";
    expect(cancelledText({ code: "cancelled", message, hint })).toBe(`Cancelled: ${message}`);
  });
});
