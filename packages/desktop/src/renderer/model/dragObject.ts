import type { ExplorerNode } from "@table-craft/desktop/renderer/model/explorerTree.js";

/** A catalog object dragged out of the Database pane, for the SQL editor to name (plan 006 decision 20). */
export interface DraggedObject {
  readonly datasourceId: string;
  /** What `catalog.qualifiedName` takes: a column's path ends with its relation. */
  readonly path: readonly string[];
  readonly name: string;
}

export const DRAG_OBJECT_TYPE = "application/x-table-craft-object";

/** The object a tree node drags as: relations, views and columns; nothing else drags. */
export function draggedObjectOf(node: ExplorerNode): DraggedObject | null {
  if (node.kind === "relation") return { datasourceId: node.datasourceId, path: node.path, name: node.relation.name };
  if (node.kind === "column") {
    return { datasourceId: node.datasourceId, path: [...node.path, node.relation], name: node.column.name };
  }
  return null;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((part) => typeof part === "string");
}

/** The dragged object in a drop's data, or null for anything the tree did not put there. */
export function parseDraggedObject(data: string): DraggedObject | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { datasourceId, path, name } = value as Record<string, unknown>;
  if (typeof datasourceId !== "string" || typeof name !== "string" || !isStringArray(path)) return null;
  return { datasourceId, path, name };
}
