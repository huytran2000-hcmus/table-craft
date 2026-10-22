import { describe, expect, it } from "vitest";
import { createLoneAlt, type KeyInput } from "@table-craft/desktop/main/menuPopup.js";

const down = (key: string): KeyInput => ({ type: "keyDown", key });
const up = (key: string): KeyInput => ({ type: "keyUp", key });

function feed(events: readonly KeyInput[]): boolean[] {
  const loneAlt = createLoneAlt();
  return events.map((event) => loneAlt.input(event));
}

describe("lone Alt", () => {
  it("givenAltAlone_whenReleased_thenPopsMenu", () => {
    expect(feed([down("Alt"), up("Alt")])).toEqual([false, true]);
    expect(feed([down("Alt"), down("Alt"), down("Alt"), up("Alt")]).at(-1)).toBe(true);
  });

  it("givenAltF_whenReleased_thenDoesNotPop", () => {
    expect(feed([down("Alt"), down("f"), up("f"), up("Alt")])).not.toContain(true);
    expect(feed([down("Alt"), down("f"), up("Alt"), up("f")])).not.toContain(true);
  });

  it("givenAltHeldWithShift_whenReleased_thenDoesNotPop", () => {
    expect(feed([down("Alt"), down("Shift"), up("Shift"), up("Alt")])).not.toContain(true);
    expect(feed([down("Shift"), down("Alt"), up("Shift"), up("Alt")])).not.toContain(true);
    expect(feed([down("Control"), down("Alt"), up("Alt"), up("Control")])).not.toContain(true);
  });

  it("givenAChordBefore_whenAltPressedAloneAfter_thenPops", () => {
    expect(feed([down("Alt"), down("f"), up("f"), up("Alt"), down("Alt"), up("Alt")]).at(-1)).toBe(true);
  });

  it("givenAKeyHeldWhenFocusLeft_whenReset_thenAltAloneStillPops", () => {
    const loneAlt = createLoneAlt();
    loneAlt.input(down("Shift"));
    loneAlt.reset();

    loneAlt.input(down("Alt"));

    expect(loneAlt.input(up("Alt"))).toBe(true);
  });
});
