import { describe, expect, it } from "vitest";
import { createTabsStore, type Tab } from "@table-craft/desktop/renderer/state/tabs.js";

function console(id: string): Tab {
  return { id, kind: "console", title: id };
}

function threeTabs() {
  const store = createTabsStore();
  for (const id of ["a", "b", "c"]) store.getState().open(console(id));
  return store;
}

describe("tabs", () => {
  it("givenThreeTabs_whenMiddleClosed_thenRightNeighbourBecomesActive", () => {
    const store = threeTabs();
    store.getState().activate("b");

    const removed = store.getState().close("b");

    expect(removed.map((tab) => tab.id)).toEqual(["b"]);
    expect(store.getState().activeId).toBe("c");
  });

  it("givenLastTabActive_whenClosed_thenLeftNeighbourBecomesActive", () => {
    const store = threeTabs();

    store.getState().close("c");

    expect(store.getState().activeId).toBe("b");
  });

  it("givenLastTabClosed_whenRendered_thenNoActiveTab", () => {
    const store = createTabsStore();
    store.getState().open(console("a"));

    store.getState().close("a");

    expect(store.getState()).toMatchObject({ tabs: [], activeId: null });
  });

  it("givenInactiveTabClosed_whenClosed_thenActiveTabStays", () => {
    const store = threeTabs();

    store.getState().close("a");

    expect(store.getState().activeId).toBe("c");
  });

  it("givenThreeTabs_whenOthersClosed_thenOnlyThatTabRemainsActive", () => {
    const store = threeTabs();

    const removed = store.getState().closeOthers("b");

    expect(removed.map((tab) => tab.id)).toEqual(["a", "c"]);
    expect(store.getState()).toMatchObject({ tabs: [console("b")], activeId: "b" });
  });

  it("givenThreeTabs_whenCycledPastEitherEnd_thenWraps", () => {
    const store = threeTabs();

    store.getState().cycle(1);
    expect(store.getState().activeId).toBe("a");
    store.getState().cycle(-1);
    expect(store.getState().activeId).toBe("c");
  });

  it("givenTabs_whenAllClosed_thenEveryTabIsReturned", () => {
    const store = threeTabs();

    expect(
      store
        .getState()
        .closeAll()
        .map((tab) => tab.id),
    ).toEqual(["a", "b", "c"]);
    expect(store.getState().activeId).toBeNull();
  });
});
