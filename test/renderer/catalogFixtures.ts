import type { ColumnMeta, DescribedCatalog, Namespace, Relation } from "@table-craft/desktop/engine/protocol.js";
import { buildTree } from "@table-craft/desktop/renderer/model/datasourceTree.js";
import {
  EMPTY_CATALOG,
  explorerRows,
  pathKey,
  type DatasourceCatalog,
  type ExplorerInput,
  type ExplorerRow,
} from "@table-craft/desktop/renderer/model/explorerTree.js";
import { view } from "./datasourceViews.js";

export const PG_VIEW = view({ id: "pg", name: "pg" });
export const PUBLIC_PATH = ["table_craft", "public"] as const;
export const AUDIT_PATH = ["table_craft", "audit"] as const;

function namespace(path: readonly string[], overrides: Partial<Namespace> = {}): Namespace {
  return {
    path,
    name: path[path.length - 1] ?? "",
    kind: "schema",
    system: false,
    current: false,
    ...overrides,
  };
}

export const PG_NAMESPACES: readonly Namespace[] = [
  namespace(["table_craft"], { kind: "database" }),
  namespace(AUDIT_PATH),
  namespace(["table_craft", "information_schema"], { system: true }),
  namespace(["table_craft", "pg_catalog"], { system: true }),
  namespace(PUBLIC_PATH, { current: true }),
];

function column(name: string, position: number, type: string, nullable = true): ColumnMeta {
  return { name, position, type, nullable, default: null, comment: null, autoIncrement: false };
}

export const CUSTOMERS: Relation = {
  name: "customers",
  kind: "table",
  comment: null,
  columns: [column("id", 1, "integer", false), column("name", 2, "text", false), column("email", 3, "text", false)],
  primaryKey: { name: "customers_pkey", columns: ["id"] },
  uniqueKeys: [{ name: "customers_email_key", columns: ["email"] }],
  foreignKeys: [],
  indexes: [],
};

export const ORDERS: Relation = {
  name: "orders",
  kind: "table",
  comment: null,
  columns: [
    column("id", 1, "integer", false),
    column("customer_id", 2, "integer", false),
    column("total", 3, "numeric(12,2)"),
    column("placed_at", 4, "timestamp"),
  ],
  primaryKey: { name: "orders_pkey", columns: ["id"] },
  uniqueKeys: [],
  foreignKeys: [
    {
      name: "orders_customer_id_fkey",
      columns: ["customer_id"],
      target: { path: PUBLIC_PATH, relation: "customers", columns: ["id"] },
      onDelete: "NO ACTION",
      onUpdate: "NO ACTION",
    },
  ],
  indexes: [{ name: "orders_placed_at_idx", columns: ["placed_at"], unique: false, primary: false }],
};

export const CUSTOMER_TOTALS: Relation = {
  name: "customer_totals",
  kind: "view",
  comment: null,
  columns: [column("customer_id", 1, "integer"), column("name", 2, "text"), column("total", 3, "numeric")],
  primaryKey: null,
  uniqueKeys: [],
  foreignKeys: [],
  indexes: [],
};

export const PUBLIC_CATALOG: DescribedCatalog = {
  catalog: { path: PUBLIC_PATH, relations: [CUSTOMER_TOTALS, CUSTOMERS, ORDERS], routines: [], sequences: [] },
  introspectedAt: 1_000,
  elapsedMs: 38,
};

/** pg with its namespaces listed and `public` described, `audit` never described. */
export const LOADED_PG: DatasourceCatalog = {
  ...EMPTY_CATALOG,
  namespaces: PG_NAMESPACES,
  namespaceStates: { [pathKey(PUBLIC_PATH)]: { described: PUBLIC_CATALOG, loading: false, error: null } },
};

export function rowsOf(overrides: Partial<ExplorerInput> = {}): readonly ExplorerRow[] {
  return explorerRows({
    tree: buildTree([PG_VIEW]),
    catalogs: { pg: LOADED_PG },
    expanded: new Set(),
    collapsedFolders: new Set(),
    showSystem: false,
    canExpand: () => true,
    ...overrides,
  });
}

/** Each row as `depth label`, e.g. `2 public`. */
export function outline(rows: readonly ExplorerRow[]): readonly string[] {
  return rows.map((row) => `${String(row.depth)} ${row.node.kind === "loading" ? "loading…" : row.label}`);
}
