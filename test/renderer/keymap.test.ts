import { describe, expect, it, vi } from "vitest";
import { APP_ACTIONS } from "@table-craft/desktop/renderer/actions/appActions.js";
import { createKeyDispatcher, findClashes } from "@table-craft/desktop/renderer/actions/keymap.js";
import { createActionRegistry, defineAction } from "@table-craft/desktop/renderer/actions/registry.js";
import { IDLE_CONTEXT, keydown } from "./support.js";

function dispatcherWith(enabled: boolean, paletteOpen = false) {
  const searched = vi.fn();
  const ran = vi.fn();
  const registry = createActionRegistry(() => IDLE_CONTEXT);
  registry.register([
    defineAction({ id: "search", title: "Search", category: "Navigation", shortcut: "Shift Shift", run: searched }),
    defineAction({
      id: "run",
      title: "Run",
      category: "Console",
      shortcut: "Mod+Enter",
      when: () => enabled,
      run: ran,
    }),
  ]);
  const dispatch = createKeyDispatcher({ registry, platform: "mac", paletteOpen: () => paletteOpen });
  return { dispatch, searched, ran };
}

describe("keymap", () => {
  it("givenRegisteredActions_whenShortcutsCompared_thenNoTwoShareAChord", () => {
    expect(findClashes(APP_ACTIONS)).toEqual([]);
  });

  it("givenTwoActionsOnOneChord_whenCompared_thenClashNamesBoth", () => {
    const run = () => undefined;
    const clashes = findClashes([
      defineAction({ id: "a", title: "A", category: "Console", shortcut: "Mod+Shift+A", run }),
      defineAction({ id: "b", title: "B", category: "Console", shortcut: "Mod+Shift+A", run }),
    ]);

    expect(clashes.map((clash) => clash.ids)).toEqual([
      ["a", "b"],
      ["a", "b"],
    ]);
  });

  it("givenShiftTwiceWithin300ms_whenDispatched_thenSearchEverywhereRuns", () => {
    const { dispatch, searched } = dispatcherWith(true);

    dispatch(keydown({ key: "Shift", timeStamp: 1000 }));
    dispatch(keydown({ key: "Shift", timeStamp: 1250 }));

    expect(searched).toHaveBeenCalledOnce();
  });

  it("givenShiftTwiceTooSlowly_whenDispatched_thenNoDoubleTap", () => {
    const { dispatch, searched } = dispatcherWith(true);

    dispatch(keydown({ key: "Shift", timeStamp: 1000 }));
    dispatch(keydown({ key: "Shift", timeStamp: 1400 }));

    expect(searched).not.toHaveBeenCalled();
  });

  it("givenShiftAThenShift_whenDispatched_thenNoDoubleTap", () => {
    const { dispatch, searched } = dispatcherWith(true);

    dispatch(keydown({ key: "Shift", timeStamp: 1000 }));
    dispatch(keydown({ key: "A", shiftKey: true, timeStamp: 1050 }));
    dispatch(keydown({ key: "Shift", timeStamp: 1100 }));

    expect(searched).not.toHaveBeenCalled();
  });

  it("givenChordForEnabledAction_whenPressed_thenRunsOnceAndEventPrevented", () => {
    const { dispatch, ran } = dispatcherWith(true);
    const event = keydown({ key: "Enter", metaKey: true });

    dispatch(event);

    expect(ran).toHaveBeenCalledOnce();
    expect(event.prevented()).toBe(true);
  });

  it("givenChordForDisabledAction_whenPressed_thenEventNotPrevented", () => {
    const { dispatch, ran } = dispatcherWith(false);
    const event = keydown({ key: "Enter", metaKey: true });

    dispatch(event);

    expect(ran).not.toHaveBeenCalled();
    expect(event.prevented()).toBe(false);
  });

  it("givenPaletteOpen_whenChordPressed_thenItPassesToThePalette", () => {
    const { dispatch, ran } = dispatcherWith(true, true);
    const event = keydown({ key: "Enter", metaKey: true });

    dispatch(event);

    expect(ran).not.toHaveBeenCalled();
    expect(event.prevented()).toBe(false);
  });

  it("givenShortcutScopedToDatabasePane_whenPressedInEditor_thenPassesThroughAndRunsInPane", () => {
    const created = vi.fn();
    const registry = createActionRegistry(() => IDLE_CONTEXT);
    registry.register([
      defineAction({
        id: "new",
        title: "New Data Source",
        category: "Database",
        shortcut: "Mod+N",
        shortcutRegion: "database",
        run: created,
      }),
    ]);
    let region: "editor" | "database" = "editor";
    const dispatch = createKeyDispatcher({
      registry,
      platform: "mac",
      paletteOpen: () => false,
      focusedRegion: () => region,
    });

    const inEditor = keydown({ key: "n", metaKey: true });
    dispatch(inEditor);
    region = "database";
    const inPane = keydown({ key: "n", metaKey: true });
    dispatch(inPane);

    expect(inEditor.prevented()).toBe(false);
    expect(inPane.prevented()).toBe(true);
    expect(created).toHaveBeenCalledTimes(1);
  });
});
