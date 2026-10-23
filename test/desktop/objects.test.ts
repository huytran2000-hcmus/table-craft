import { afterEach, describe, expect, it } from "vitest";
import type { PluginLoadResult } from "@table-craft/core";
import sqlite from "@table-craft/plugin-sqlite";
import type {
  AppliedChange,
  DdlScript,
  DescribedCatalog,
  EngineResponse,
  ObjectChange,
  TableDesign,
} from "@table-craft/desktop/engine/protocol.js";
import { engineRequestSchema } from "@table-craft/desktop/engine/requests.js";
import { execute, exportHarness, openSession, resultOf, type ExportHarness } from "../support/engineExports.js";
import { SQLITE_MANIFEST } from "../support/manifests.js";
import { seededSqliteFile } from "../support/sqliteFixture.js";

const LOADED_SQLITE: PluginLoadResult = {
  status: "loaded",
  directory: "plugins/sqlite",
  manifest: SQLITE_MANIFEST,
  plugin: sqlite,
};
const MAIN = ["main"];

const NOTES: TableDesign = {
  name: "notes",
  comment: null,
  columns: [
    {
      name: "id",
      type: "INTEGER",
      nullable: false,
      default: null,
      autoIncrement: false,
      comment: null,
      original: null,
    },
    { name: "body", type: "TEXT", nullable: true, default: null, autoIncrement: false, comment: null, original: null },
  ],
  primaryKey: ["id"],
  primaryKeyName: null,
  indexes: [],
  foreignKeys: [],
  checks: [],
};

function failure(response: EngineResponse): { code: string; message: string } {
  if (response.type !== "engine.error") throw new Error("expected an engine error");
  return response.error;
}

describe("engine objects", () => {
  const cleanup: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const step of cleanup.splice(0).reverse()) await step();
  });

  function open(path: string, readOnly = false): ExportHarness {
    const opened = exportHarness(
      { id: "objects", pluginId: "sqlite", config: { path }, readOnly, keepAliveSeconds: 0 },
      [LOADED_SQLITE],
    );
    cleanup.push(() => opened.close());
    return opened;
  }

  async function script(opened: ExportHarness, change: ObjectChange): Promise<DdlScript> {
    return resultOf<DdlScript>(await opened.connection.handle({ id: 7, type: "objects.script", change }));
  }

  function apply(opened: ExportHarness, change: ObjectChange, statements: readonly string[]): Promise<EngineResponse> {
    return opened.connection.handle({ id: 8, type: "objects.apply", change, statements });
  }

  async function relations(opened: ExportHarness): Promise<readonly string[]> {
    const described = resultOf<DescribedCatalog>(
      await opened.connection.handle({ id: 6, type: "catalog.describe", path: MAIN }),
    );
    return described.catalog.relations.map((relation) => relation.name);
  }

  it("givenNewTable_whenPreviewedAndApplied_thenCatalogShowsIt", async () => {
    const opened = open(seededSqliteFile());
    await relations(opened);
    const change: ObjectChange = { kind: "createTable", path: MAIN, design: NOTES };

    const preview = await script(opened, change);
    const applied = resultOf<AppliedChange>(await apply(opened, change, preview.statements));

    expect(preview.statements[0]).toMatch(/^CREATE TABLE "main"\."notes" \(/u);
    expect(applied.statements).toBe(preview.statements.length);
    expect(await relations(opened)).toContain("notes");
  });

  it("givenExistingTable_whenDesigned_thenColumnsAndKeyComeBack", async () => {
    const opened = open(seededSqliteFile());

    const design = resultOf<TableDesign>(
      await opened.connection.handle({ id: 5, type: "objects.design", path: MAIN, relation: "customers" }),
    );

    expect(design.name).toBe("customers");
    expect(design.primaryKey).toEqual(["id"]);
    expect(design.columns.map((column) => column.original)).toEqual(design.columns.map((column) => column.name));
  });

  it("givenTableWithIndex_whenDesignSentBackForPreview_thenRequestAcceptedAndNothingToChange", async () => {
    const opened = open(seededSqliteFile());
    const design = resultOf<TableDesign>(
      await opened.connection.handle({ id: 5, type: "objects.design", path: MAIN, relation: "orders" }),
    );
    expect(design.indexes.length).toBeGreaterThan(0);

    const parsed = engineRequestSchema.safeParse({
      id: 7,
      type: "objects.script",
      change: { kind: "alterTable", path: MAIN, relation: "orders", design },
    });

    expect(parsed.error?.issues).toBeUndefined();
    const unchanged = await script(opened, { kind: "alterTable", path: MAIN, relation: "orders", design });
    expect(unchanged.statements).toEqual([]);
  });

  it("givenPreviewThatDiffers_whenApplied_thenRefusedAndNothingRuns", async () => {
    const opened = open(seededSqliteFile());
    const change: ObjectChange = { kind: "createTable", path: MAIN, design: NOTES };

    const response = await apply(opened, change, ["DROP TABLE customers"]);

    expect(failure(response).message).toMatch(/changed since the preview/u);
    expect(await relations(opened)).toContain("customers");
    expect(await relations(opened)).not.toContain("notes");
  });

  it("givenDrop_whenApplied_thenTableGoneFromCatalog", async () => {
    const opened = open(seededSqliteFile());
    const change: ObjectChange = {
      kind: "drop",
      path: MAIN,
      object: { kind: "table", name: "no_key_probe" },
      cascade: false,
    };

    resultOf<AppliedChange>(await apply(opened, change, (await script(opened, change)).statements));

    expect(await relations(opened)).not.toContain("no_key_probe");
  });

  it("givenFailingStatement_whenApplied_thenStatementFailedAndNothingChanged", async () => {
    const opened = open(seededSqliteFile());
    const design: TableDesign = {
      ...NOTES,
      indexes: [{ name: "customers", columns: ["body"], unique: false, original: null }],
    };
    const change: ObjectChange = { kind: "createTable", path: MAIN, design };

    const response = await apply(opened, change, (await script(opened, change)).statements);

    expect(failure(response)).toMatchObject({ code: "statementFailed" });
    expect(failure(response).message).toMatch(/^Statement 2 failed/u);
    const sessionId = await openSession(opened.connection);
    const left = await execute(opened.connection, sessionId, "SELECT COUNT(*) FROM sqlite_schema WHERE name = 'notes'");
    expect(left.firstWindow.rows).toEqual([[0]]);
  });

  it("givenReadOnlyDatasource_whenApplied_thenRefused", async () => {
    const opened = open(seededSqliteFile(), true);
    const change: ObjectChange = { kind: "createTable", path: MAIN, design: NOTES };

    const response = await apply(opened, change, (await script(opened, change)).statements);

    expect(failure(response).message).toMatch(/read-only/u);
  });

  it("givenInMemoryDatabase_whenApplied_thenRefused", async () => {
    const opened = open(":memory:");
    const change: ObjectChange = { kind: "createTable", path: MAIN, design: NOTES };

    const response = await apply(opened, change, (await script(opened, change)).statements);

    expect(failure(response).message).toMatch(/in-memory/u);
  });

  it("givenInvalidDesign_whenPreviewed_thenStatementFailedWithDesignHint", async () => {
    const opened = open(seededSqliteFile());
    const change: ObjectChange = { kind: "createTable", path: MAIN, design: { ...NOTES, columns: [] } };

    const response = await opened.connection.handle({ id: 7, type: "objects.script", change });

    expect(failure(response)).toMatchObject({ code: "statementFailed" });
  });
});
