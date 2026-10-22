import { describe, expect, it, vi } from "vitest";
import { ALL_ACTIONS } from "@table-craft/desktop/renderer/actions/allActions.js";
import type { FocusRegion } from "@table-craft/desktop/renderer/actions/context.js";
import { createKeyDispatcher, findClashes, findReservedClashes } from "@table-craft/desktop/renderer/actions/keymap.js";
import { createActionRegistry, defineAction } from "@table-craft/desktop/renderer/actions/registry.js";
import { EDITOR_CHORDS } from "@table-craft/desktop/renderer/console/editorKeys.js";
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
    expect(findClashes(ALL_ACTIONS)).toEqual([]);
  });

  it("givenEditorChords_whenComparedWithKeymap_thenNoClash", () => {
    expect(findReservedClashes(ALL_ACTIONS, EDITOR_CHORDS, "editor")).toEqual([]);
  });

  it("givenActionOnEditorChordOutsideEditorOnly_whenCompared_thenNoClashButUnscopedOneClashes", () => {
    const run = () => undefined;
    const scoped = defineAction({
      id: "scoped",
      title: "Scoped",
      category: "Database",
      shortcut: "Mod+D",
      shortcutRegion: ["database", "services"],
      run,
    });
    const unscoped = defineAction({ id: "unscoped", title: "Unscoped", category: "Console", shortcut: "Mod+/", run });

    const clashes = findReservedClashes([scoped, unscoped], EDITOR_CHORDS, "editor");

    expect(clashes.map((clash) => clash.ids)).toEqual([["unscoped"], ["unscoped"]]);
  });

  it("givenReservedChord_whenPressedInEditor_thenRegistryLetsItPass", () => {
    const ran = vi.fn();
    const registry = createActionRegistry(() => IDLE_CONTEXT);
    registry.register([defineAction({ id: "undo", title: "Undo", category: "Console", shortcut: "Mod+Z", run: ran })]);
    let reserved: readonly string[] = EDITOR_CHORDS;
    const dispatch = createKeyDispatcher({
      registry,
      platform: "mac",
      paletteOpen: () => false,
      reservedChords: () => reserved,
    });

    const inEditor = keydown({ key: "z", metaKey: true });
    dispatch(inEditor);
    reserved = [];
    const elsewhere = keydown({ key: "z", metaKey: true });
    dispatch(elsewhere);

    expect(inEditor.prevented()).toBe(false);
    expect(elsewhere.prevented()).toBe(true);
    expect(ran).toHaveBeenCalledTimes(1);
  });

  it("givenActionScopedToSeveralRegions_whenFocusMoves_thenFiresOnlyInThem", () => {
    const ran = vi.fn();
    const registry = createActionRegistry(() => IDLE_CONTEXT);
    registry.register([
      defineAction({
        id: "back",
        title: "Back",
        category: "Navigation",
        shortcut: "Escape",
        shortcutRegion: ["database", "services"],
        run: ran,
      }),
    ]);
    let region: FocusRegion = "services";
    const dispatch = createKeyDispatcher({
      registry,
      platform: "mac",
      paletteOpen: () => false,
      focusedRegion: () => region,
    });

    dispatch(keydown({ key: "Escape" }));
    region = "editor";
    dispatch(keydown({ key: "Escape" }));

    expect(ran).toHaveBeenCalledTimes(1);
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

describe("grid keymap", () => {
  function dispatcherIn(region: () => FocusRegion) {
    const ran: string[] = [];
    const registry = createActionRegistry(() => IDLE_CONTEXT);
    registry.register(
      ALL_ACTIONS.map((action) => ({ ...action, when: undefined, run: () => void ran.push(action.id) })),
    );
    const dispatch = createKeyDispatcher({
      registry,
      platform: "mac",
      paletteOpen: () => false,
      focusedRegion: region,
    });
    return { dispatch, ran };
  }

  it("givenGridFocused_whenModC_thenGridCopyNotEditorCopy", () => {
    let region: FocusRegion = "grid";
    const { dispatch, ran } = dispatcherIn(() => region);

    const inGrid = keydown({ key: "c", metaKey: true });
    dispatch(inGrid);
    region = "editor";
    const inEditor = keydown({ key: "c", metaKey: true });
    dispatch(inEditor);

    expect(ran).toEqual(["grid.copy"]);
    expect(inGrid.prevented()).toBe(true);
    expect(inEditor.prevented()).toBe(false);
  });

  it("givenGridFocused_whenGridChordsPressed_thenGridActionsRun", () => {
    const { dispatch, ran } = dispatcherIn(() => "grid");

    dispatch(keydown({ key: "a", metaKey: true }));
    dispatch(keydown({ key: "Enter", code: "Enter", shiftKey: true }));
    dispatch(keydown({ key: "r", metaKey: true }));

    expect(ran).toEqual(["grid.selectAll", "grid.toggleValuePanel", "grid.rerun"]);
  });

  it("givenGridChords_whenListed_thenAllScopedToTheGrid", () => {
    const gridChords = ALL_ACTIONS.filter(
      (action) => action.category === "Result Grid" && action.shortcut !== undefined,
    );
    expect(gridChords.every((action) => action.shortcutRegion === "grid")).toBe(true);
    expect(gridChords.map((action) => action.shortcut)).toEqual(["Mod+R", "Mod+C", "Mod+A", "Shift+Enter"]);
  });
});

describe("table editor keymap", () => {
  const tableActions = ALL_ACTIONS.filter((action) => action.category === "Table Editor");

  it("givenTableActions_whenKeymapBuilt_thenNoChordClash", () => {
    expect(findClashes(tableActions)).toEqual([]);
    expect(findClashes(ALL_ACTIONS)).toEqual([]);
    // The WHERE and ORDER BY bars are SQL editors in the table editor's region.
    expect(findReservedClashes(ALL_ACTIONS, EDITOR_CHORDS, "tableEditor")).toEqual([]);
  });

  it("givenTableTabActive_whenModEnterInGrid_thenSubmitRunsNotConsoleRun", () => {
    const ran: string[] = [];
    const registry = createActionRegistry(() => ({
      ...IDLE_CONTEXT,
      activeTab: { id: "table-0", kind: "table", title: "orders" },
    }));
    registry.register(
      ALL_ACTIONS.filter((action) => action.shortcut === "Mod+Enter").map((action) =>
        defineAction({ ...action, when: undefined, run: () => void ran.push(action.id) }),
      ),
    );
    const dispatch = createKeyDispatcher({
      registry,
      platform: "mac",
      paletteOpen: () => false,
      focusedRegion: () => "grid",
    });

    dispatch(keydown({ key: "Enter", code: "Enter", metaKey: true }));

    expect(ran).toEqual(["table.submit"]);
  });

  it("givenTableShortcuts_whenListed_thenEachBoundToTableTabs", () => {
    const bound = tableActions.filter((action) => action.shortcut !== undefined);
    expect(bound.length).toBeGreaterThan(0);
    expect(bound.every((action) => action.tabKind === "table" && action.shortcutRegion !== undefined)).toBe(true);
  });

  it("givenModEnter_whenListed_thenRunInConsolesSubmitInTables", () => {
    const owners = ALL_ACTIONS.filter((action) => action.shortcut === "Mod+Enter").map((action) => [
      action.id,
      action.tabKind,
    ]);
    expect(owners).toEqual([
      ["console.run", "console"],
      ["table.submit", "table"],
      ["table.applyValue", "table"],
    ]);
  });
});
