import { describe, expect, it } from "vitest";
import type { Capability, Declaration, DescribedCatalog } from "@table-craft/desktop/engine/protocol.js";
import { openDdlIn } from "@table-craft/desktop/renderer/actions/ddlCommands.js";
import { declarationTarget } from "@table-craft/desktop/renderer/actions/navigationActions.js";
import type { EngineClient } from "@table-craft/desktop/renderer/engine/client.js";
import { columnKey, columnNameOf, relationKey } from "@table-craft/desktop/renderer/model/explorerTree.js";
import { quickDocOf } from "@table-craft/desktop/renderer/model/quickDoc.js";
import { createCatalogStore } from "@table-craft/desktop/renderer/state/catalog.js";
import { createDdlStore, followRedescribes } from "@table-craft/desktop/renderer/state/ddl.js";
import { generatorAnswer, parseGeneratorAnswer, steppedStatement } from "@table-craft/desktop/renderer/state/modal.js";
import { activeTab, createTabsStore } from "@table-craft/desktop/renderer/state/tabs.js";
import { LOADED_PG, PG_NAMESPACES, PUBLIC_CATALOG, PUBLIC_PATH } from "./catalogFixtures.js";

const ORDERS_DDL = "CREATE TABLE public.orders (\n  id integer NOT NULL\n);";
const WITH_DDL: readonly Capability[] = ["sql", "schemaTree", "ddl"];
const WITHOUT_DDL: readonly Capability[] = ["sql", "schemaTree"];
const ORDERS_TARGET = { datasourceId: "pg", path: PUBLIC_PATH, relation: "orders" };

/** An engine that lists pg's namespaces, describes `public` afresh each time and counts definition reads. */
function engine() {
  const definitions: { path: unknown; name: unknown }[] = [];
  let describes = 0;
  const client = {
    call(type: string, params: Record<string, unknown>): Promise<unknown> {
      if (type === "catalog.namespaces") return Promise.resolve(PG_NAMESPACES);
      if (type === "catalog.describe") {
        describes += 1;
        const described: DescribedCatalog = { ...PUBLIC_CATALOG, introspectedAt: describes };
        return Promise.resolve(described);
      }
      if (type === "catalog.definition") {
        definitions.push({ path: params.path, name: params.name });
        return Promise.resolve(ORDERS_DDL);
      }
      return Promise.resolve(null);
    },
    fail: () => undefined,
    onEvent: () => () => undefined,
  };
  return { client: client as EngineClient, definitions };
}

function stores() {
  const { client, definitions } = engine();
  const connect = () => Promise.resolve(client);
  return {
    tabs: createTabsStore(),
    ddl: createDdlStore({ connect }),
    catalog: createCatalogStore({ connect }),
    definitions,
  };
}

async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("DDL tabs", () => {
  it("givenRelation_whenOpeningDdl_thenTabReadsTheDefinition", async () => {
    const { tabs, ddl, definitions } = stores();

    await openDdlIn({ tabs, ddl }, ORDERS_TARGET);

    const tab = activeTab(tabs.getState());
    expect(tab).toMatchObject({ kind: "ddl", title: "orders" });
    expect(ddl.getState().ddls[tab?.id ?? ""]).toMatchObject({ text: ORDERS_DDL, loading: false, error: null });
    expect(definitions).toEqual([{ path: PUBLIC_PATH, name: "orders" }]);
  });

  it("givenDdlTabOpen_whenOpeningSameRelation_thenFocusesExisting", async () => {
    const { tabs, ddl, definitions } = stores();
    await openDdlIn({ tabs, ddl }, ORDERS_TARGET);
    const first = activeTab(tabs.getState())?.id;
    await openDdlIn({ tabs, ddl }, { ...ORDERS_TARGET, relation: "customers" });

    await openDdlIn({ tabs, ddl }, { ...ORDERS_TARGET, path: [...PUBLIC_PATH] });

    expect(tabs.getState().tabs).toHaveLength(2);
    expect(activeTab(tabs.getState())?.id).toBe(first);
    expect(definitions).toHaveLength(2);
  });

  it("givenOpenDdlTab_whenNamespaceRedescribed_thenRefetches", async () => {
    const { tabs, ddl, catalog, definitions } = stores();
    const unfollow = followRedescribes(ddl, catalog);
    await catalog.getState().expandDatasource("pg");
    await openDdlIn({ tabs, ddl }, ORDERS_TARGET);
    expect(definitions).toHaveLength(1);

    await catalog.getState().refreshCached("pg");
    await settled();

    expect(definitions).toHaveLength(2);
    unfollow();
  });

  it("givenOpenDdlTab_whenOtherNamespaceDescribed_thenDoesNotRefetch", async () => {
    const { tabs, ddl, catalog, definitions } = stores();
    const unfollow = followRedescribes(ddl, catalog);
    await catalog.getState().expandDatasource("pg");
    await openDdlIn({ tabs, ddl }, { ...ORDERS_TARGET, path: ["table_craft", "audit"] });

    await catalog.getState().synchronize("pg", PUBLIC_PATH);
    await settled();

    expect(definitions).toHaveLength(1);
    unfollow();
  });

  it("givenNamespaceNotDescribed_whenEnsuringDescribed_thenDescribesWithoutExpanding", async () => {
    const { catalog } = stores();

    await catalog.getState().ensureDescribed("pg", PUBLIC_PATH);

    expect(catalog.getState().catalogs.pg?.namespaceStates[JSON.stringify(PUBLIC_PATH)]?.described).not.toBeNull();
    expect(catalog.getState().expanded.size).toBe(0);
  });
});

describe("Go to Declaration", () => {
  const relation: Declaration = { kind: "relation", path: PUBLIC_PATH, relation: "orders" };
  const column: Declaration = { kind: "column", path: PUBLIC_PATH, relation: "orders", column: "total" };

  it("givenPluginWithDdl_whenGoingToDeclarationOnRelation_thenOpensDdl", () => {
    expect(declarationTarget(relation, WITH_DDL)).toBe("ddl");
  });

  it("givenPluginWithoutDdl_whenGoingToDeclarationOnRelation_thenReveals", () => {
    expect(declarationTarget(relation, WITHOUT_DDL)).toBe("reveal");
  });

  it("givenColumn_whenGoingToDeclaration_thenRevealsEvenWithDdl", () => {
    expect(declarationTarget(column, WITH_DDL)).toBe("reveal");
  });

  it("givenAlias_whenGoingToDeclaration_thenJumps", () => {
    expect(declarationTarget({ kind: "alias", from: 20, to: 21 }, WITH_DDL)).toBe("jump");
  });
});

describe("Quick Documentation", () => {
  it("givenColumnSelected_whenQuickDoc_thenShowsTypeAndKeys", () => {
    const doc = quickDocOf(LOADED_PG, { ...ORDERS_TARGET, column: "customer_id" });

    expect(doc).toEqual({
      kind: "column",
      qualifiedName: "table_craft.public.orders.customer_id",
      column: {
        name: "customer_id",
        type: "integer",
        nullable: false,
        default: null,
        comment: null,
        marks: ["foreign"],
      },
      keys: ["orders_customer_id_fkey"],
    });
  });

  it("givenReferencedTable_whenQuickDoc_thenListsIncomingForeignKeys", () => {
    const doc = quickDocOf(LOADED_PG, { ...ORDERS_TARGET, relation: "customers" });

    expect(doc).toMatchObject({
      kind: "relation",
      relationKind: "table",
      qualifiedName: "table_craft.public.customers",
      primaryKey: { name: "customers_pkey", columns: ["id"] },
      outgoing: [],
      incoming: [{ name: "orders_customer_id_fkey", columns: ["id"], other: "orders", otherColumns: ["customer_id"] }],
    });
    expect(doc?.kind === "relation" ? doc.columns.map((entry) => [entry.name, entry.marks]) : []).toEqual([
      ["id", ["primary"]],
      ["name", []],
      ["email", []],
    ]);
  });

  it("givenTable_whenQuickDoc_thenListsOutgoingKeysAndIndexes", () => {
    const doc = quickDocOf(LOADED_PG, ORDERS_TARGET);

    expect(doc).toMatchObject({
      outgoing: [{ name: "orders_customer_id_fkey", other: "customers", otherColumns: ["id"] }],
      indexes: [{ name: "orders_placed_at_idx" }],
    });
  });

  it("givenRelationNotInCatalog_whenQuickDoc_thenNull", () => {
    expect(quickDocOf(LOADED_PG, { ...ORDERS_TARGET, relation: "missing" })).toBeNull();
    expect(quickDocOf(undefined, ORDERS_TARGET)).toBeNull();
  });

  it("givenColumnKey_whenReadingColumnName_thenNamesTheColumnAndNothingElse", () => {
    expect(columnNameOf(columnKey("pg", PUBLIC_PATH, "orders", "total"))).toBe("total");
    expect(columnNameOf(relationKey("pg", PUBLIC_PATH, "orders"))).toBeNull();
    expect(columnNameOf("datasource:pg")).toBeNull();
  });
});

describe("SQL Generator answers", () => {
  it("givenChoiceAndStatement_whenParsed_thenRoundTrips", () => {
    expect(parseGeneratorAnswer(generatorAnswer("copy", "update"))).toEqual({ choice: "copy", statement: "update" });
  });

  it("givenSelectChosen_whenArrowKeysPressed_thenMovesAndWrapsAcrossStatements", () => {
    const statements = ["create", "drop", "select", "insert", "update"];
    expect(steppedStatement(statements, "select", "ArrowRight")).toBe("insert");
    expect(steppedStatement(statements, "select", "ArrowUp")).toBe("drop");
    expect(steppedStatement(statements, "update", "ArrowDown")).toBe("create");
    expect(steppedStatement(statements, "create", "ArrowLeft")).toBe("update");
    expect(steppedStatement(statements, "select", "Enter")).toBeNull();
  });
});
