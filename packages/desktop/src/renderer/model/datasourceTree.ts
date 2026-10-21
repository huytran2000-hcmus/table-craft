import type { DatasourceView } from "@table-craft/desktop/preload/bridge.js";

export interface FolderNode {
  readonly kind: "folder";
  /** The full `/`-separated path, which is the folder's identity. */
  readonly path: string;
  readonly name: string;
  readonly children: readonly TreeNode[];
}

export interface DatasourceNode {
  readonly kind: "datasource";
  readonly datasource: DatasourceView;
}

export type TreeNode = FolderNode | DatasourceNode;

interface MutableFolder {
  readonly path: string;
  readonly name: string;
  readonly folders: Map<string, MutableFolder>;
  readonly datasources: DatasourceView[];
}

const byName = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

function folder(path: string, name: string): MutableFolder {
  return { path, name, folders: new Map(), datasources: [] };
}

function ensure(root: MutableFolder, path: string): MutableFolder {
  let current = root;
  for (const part of path.split("/")) {
    const childPath = current.path === "" ? part : `${current.path}/${part}`;
    let child = current.folders.get(part);
    if (child === undefined) {
      child = folder(childPath, part);
      current.folders.set(part, child);
    }
    current = child;
  }
  return current;
}

function freeze(node: MutableFolder): readonly TreeNode[] {
  const folders = [...node.folders.values()]
    .sort((a, b) => byName.compare(a.name, b.name))
    .map((child): FolderNode => ({ kind: "folder", path: child.path, name: child.name, children: freeze(child) }));
  const datasources = [...node.datasources]
    .sort((a, b) => byName.compare(a.name, b.name))
    .map((datasource): DatasourceNode => ({ kind: "datasource", datasource }));
  return [...folders, ...datasources];
}

/** The Database pane's tree: folders from the paths, folders before datasources, each by name. */
export function buildTree(
  datasources: readonly DatasourceView[],
  emptyFolders: readonly string[] = [],
): readonly TreeNode[] {
  const root = folder("", "");
  for (const path of emptyFolders) ensure(root, path);
  for (const datasource of datasources) {
    (datasource.folder === null ? root : ensure(root, datasource.folder)).datasources.push(datasource);
  }
  return freeze(root);
}

export interface VisibleRow {
  readonly node: TreeNode;
  readonly depth: number;
  /** The selection key: `datasource:<id>` or `folder:<path>`. */
  readonly key: string;
}

export function nodeKey(node: TreeNode): string {
  return node.kind === "folder" ? `folder:${node.path}` : `datasource:${node.datasource.id}`;
}

/** The rows a keyboard walks, in order, skipping the children of collapsed folders. */
export function visibleRows(
  nodes: readonly TreeNode[],
  collapsed: ReadonlySet<string>,
  depth = 0,
): readonly VisibleRow[] {
  return nodes.flatMap((node) => {
    const row: VisibleRow = { node, depth, key: nodeKey(node) };
    if (node.kind === "datasource" || collapsed.has(node.path)) return [row];
    return [row, ...visibleRows(node.children, collapsed, depth + 1)];
  });
}

/** Every folder path the datasources use, for the folder field's suggestions. */
export function folderPaths(datasources: readonly DatasourceView[], emptyFolders: readonly string[] = []): string[] {
  const paths = new Set<string>(emptyFolders);
  for (const { folder: path } of datasources) {
    if (path === null) continue;
    const parts = path.split("/");
    parts.forEach((_, index) => paths.add(parts.slice(0, index + 1).join("/")));
  }
  return [...paths].sort((a, b) => byName.compare(a, b));
}
