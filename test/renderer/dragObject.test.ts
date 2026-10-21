import { describe, expect, it } from "vitest";
import { draggedObjectOf, parseDraggedObject } from "@table-craft/desktop/renderer/model/dragObject.js";
import type { ExplorerNode } from "@table-craft/desktop/renderer/model/explorerTree.js";

const PATH = ["table_craft", "public"];

describe("dragged objects", () => {
  it("givenRelationNode_whenDragged_thenCarriesItsPathAndName", () => {
    const node = {
      kind: "relation",
      datasourceId: "pg",
      path: PATH,
      relation: { name: "orders" },
    } as unknown as ExplorerNode;

    expect(draggedObjectOf(node)).toEqual({ datasourceId: "pg", path: PATH, name: "orders" });
  });

  it("givenColumnNode_whenDragged_thenItsPathEndsWithItsRelation", () => {
    const node = {
      kind: "column",
      datasourceId: "pg",
      path: PATH,
      relation: "orders",
      column: { name: "total" },
    } as unknown as ExplorerNode;

    expect(draggedObjectOf(node)).toEqual({ datasourceId: "pg", path: [...PATH, "orders"], name: "total" });
  });

  it("givenNamespaceNode_whenDragged_thenNothingDrags", () => {
    const node = { kind: "namespace", datasourceId: "pg", path: PATH } as unknown as ExplorerNode;

    expect(draggedObjectOf(node)).toBeNull();
  });

  it("givenForeignData_whenParsed_thenNull", () => {
    expect(parseDraggedObject("orders")).toBeNull();
    expect(parseDraggedObject(JSON.stringify({ datasourceId: "pg", path: [1], name: "orders" }))).toBeNull();
    expect(parseDraggedObject(JSON.stringify({ datasourceId: "pg", path: PATH, name: "orders" }))).toEqual({
      datasourceId: "pg",
      path: PATH,
      name: "orders",
    });
  });
});
