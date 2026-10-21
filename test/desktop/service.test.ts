import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createConsoleFiles } from "@table-craft/desktop/main/consoleFiles.js";
import { createDatasourceStore, DATASOURCES_FILE } from "@table-craft/desktop/main/datasources.js";
import { createHostRegistry } from "@table-craft/desktop/main/hosts.js";
import { listPlugins } from "@table-craft/desktop/main/plugins.js";
import { createSecretStore } from "@table-craft/desktop/main/secrets.js";
import {
  createDatasourceService,
  DatasourceError,
  type EphemeralDatasource,
} from "@table-craft/desktop/main/service.js";
import type { DatasourceDraft, DatasourceList, SaveDatasourceRequest } from "@table-craft/desktop/preload/bridge.js";
import { fakeHostDependencies } from "../support/fakeHosts.js";
import { fakeCipher, memoryFiles } from "../support/memoryFiles.js";

const DIRECTORY = "/profile";
const BUILT_IN_PLUGINS = join(import.meta.dirname, "../../plugins");
const SECRET = "hunter2";
const WINDOW = "window-1";

const PG_DRAFT: DatasourceDraft = {
  name: "Local PG",
  pluginId: "postgres",
  folder: "Docker/Main",
  color: null,
  readOnly: false,
  comment: "",
  config: { host: "127.0.0.1", port: 55432, database: "table_craft", user: "table_craft", sslMode: "disable" },
  secretModes: { password: "forever" },
};

async function service(options: { ephemeral?: EphemeralDatasource; cipher?: ReturnType<typeof fakeCipher> } = {}) {
  const files = memoryFiles();
  const cipher = options.cipher ?? fakeCipher();
  const dependencies = fakeHostDependencies();
  const changes: DatasourceList[] = [];
  let ids = 0;
  const hosts = createHostRegistry({ pluginRoots: [], dependencies, onExit: () => undefined });
  const created = await createDatasourceService({
    store: createDatasourceStore({ directory: DIRECTORY, files }),
    secrets: await createSecretStore({ directory: DIRECTORY, files, cipher }),
    hosts,
    plugins: await listPlugins([BUILT_IN_PLUGINS]),
    ephemeral: options.ephemeral ?? null,
    newId: () => `id-${String(++ids)}`,
    consoles: createConsoleFiles({ directory: DIRECTORY, files }),
    onChanged: (list) => changes.push(list),
  });
  return { files, cipher, dependencies, changes, service: created };
}

function saving(datasource: DatasourceDraft, password?: string): SaveDatasourceRequest {
  return {
    datasource,
    secrets: password === undefined ? {} : { password: { action: "set", value: password } },
  };
}

function bootedConfig(dependencies: ReturnType<typeof fakeHostDependencies>, index = 0): unknown {
  return (dependencies.forked[index]?.posted[0] as { datasource?: unknown } | undefined)?.datasource;
}

describe("listPlugins", () => {
  it("givenBuiltInPluginSources_whenListed_thenFormsReadWithoutRunningCode", async () => {
    const plugins = await listPlugins([BUILT_IN_PLUGINS]);

    expect(plugins.map((plugin) => plugin.id).sort()).toEqual(["mysql", "postgres", "sqlite"]);
    expect(plugins.find((plugin) => plugin.id === "sqlite")?.fields).toEqual([
      expect.objectContaining({ key: "path", kind: "file" }),
    ]);
    expect(plugins.every((plugin) => plugin.unavailableReason === null)).toBe(true);
  });
});

describe("datasource service", () => {
  it("givenForeverSecret_whenSaved_thenDatasourcesJsonHasNoSecretValue", async () => {
    const { files, service: datasources } = await service();

    const saved = await datasources.save(saving(PG_DRAFT, SECRET));

    const json = files.contents.get(`${DIRECTORY}/${DATASOURCES_FILE}`) ?? "";
    expect(json).not.toContain(SECRET);
    expect(JSON.parse(json)).toMatchObject({ datasources: [{ id: saved.id, secretModes: { password: "forever" } }] });
    expect(saved.storedSecrets).toEqual(["password"]);
    expect(JSON.stringify(datasources.list())).not.toContain(SECRET);
  });

  it("givenEncryptionUnavailable_whenSavingForever_thenRefusedWithReason", async () => {
    const cipher = fakeCipher();
    cipher.available = false;
    const { files, service: datasources } = await service({ cipher });

    await expect(datasources.save(saving(PG_DRAFT, SECRET))).rejects.toThrow(DatasourceError);
    await expect(datasources.save(saving(PG_DRAFT, SECRET))).rejects.toThrow("keychain");
    expect(files.contents.size).toBe(0);
  });

  it("givenEncryptionUnavailable_whenSecretModeOmitted_thenDefaultsToUntilRestart", async () => {
    const cipher = fakeCipher();
    cipher.available = false;
    const { service: datasources } = await service({ cipher });

    const saved = await datasources.save(saving({ ...PG_DRAFT, secretModes: {} }, SECRET));

    expect(saved.secretModes).toEqual({ password: "untilRestart" });
  });

  it("givenBlankSecretOnEdit_whenSaved_thenStoredSecretKept", async () => {
    const { dependencies, service: datasources } = await service();
    const saved = await datasources.save(saving(PG_DRAFT, SECRET));

    await datasources.save({ datasource: { ...saved, name: "Renamed" }, secrets: { password: { action: "keep" } } });
    await datasources.connect(saved.id, {}, WINDOW);

    expect(datasources.list().datasources[0]?.name).toBe("Renamed");
    expect(bootedConfig(dependencies)).toMatchObject({ config: { password: SECRET } });
  });

  it("givenClearedSecret_whenSaved_thenNoLongerStored", async () => {
    const { service: datasources } = await service();
    const saved = await datasources.save(saving(PG_DRAFT, SECRET));

    const cleared = await datasources.save({ datasource: saved, secrets: { password: { action: "clear" } } });

    expect(cleared.storedSecrets).toEqual([]);
  });

  it("givenNeverSecret_whenConnecting_thenNeedsSecretsReturned", async () => {
    const { dependencies, service: datasources } = await service();
    const saved = await datasources.save(saving({ ...PG_DRAFT, secretModes: { password: "never" } }, SECRET));

    expect(await datasources.connect(saved.id, {}, WINDOW)).toEqual({ status: "needsSecrets", keys: ["password"] });
    expect(dependencies.forked).toHaveLength(0);

    expect(await datasources.connect(saved.id, { password: SECRET }, WINDOW)).toEqual({ status: "connected" });
    expect(bootedConfig(dependencies)).toMatchObject({ config: { password: SECRET } });
  });

  it("givenNeverSecretAndRunningEngine_whenSecondConsoleConnects_thenNotAskedAgain", async () => {
    const { dependencies, service: datasources } = await service();
    const saved = await datasources.save(saving({ ...PG_DRAFT, secretModes: { password: "never" } }));
    await datasources.connect(saved.id, { password: SECRET }, WINDOW);

    expect(await datasources.connect(saved.id, {}, WINDOW)).toEqual({ status: "connected" });
    expect(dependencies.ports).toHaveLength(2);
  });

  it("givenKeychainLost_whenConnecting_thenAskedLikeNever", async () => {
    const { cipher, service: datasources } = await service();
    const saved = await datasources.save(saving(PG_DRAFT, SECRET));
    cipher.lost = true;

    expect(await datasources.connect(saved.id, {}, WINDOW)).toEqual({ status: "needsSecrets", keys: ["password"] });
  });

  it("givenReadOnlyDatasource_whenConnected_thenEngineBootsReadOnly", async () => {
    const { dependencies, service: datasources } = await service();
    const saved = await datasources.save(saving({ ...PG_DRAFT, readOnly: true }, SECRET));

    await datasources.connect(saved.id, {}, WINDOW);

    expect(bootedConfig(dependencies)).toMatchObject({ readOnly: true });
  });

  it("givenEditedDatasourceWithBlankSecret_whenTested_thenStoredSecretMergedInMain", async () => {
    const { dependencies, service: datasources } = await service();
    const saved = await datasources.save(saving(PG_DRAFT, SECRET));

    void datasources.test({ datasource: saved, secrets: {} });

    expect(bootedConfig(dependencies)).toMatchObject({ config: { password: SECRET } });
    expect(dependencies.forked[0]?.posted[0]).toMatchObject({ mode: "probe" });
  });

  it("givenRequiredFieldBlank_whenSaved_thenRefusedNamingIt", async () => {
    const { service: datasources } = await service();

    await expect(datasources.save(saving({ ...PG_DRAFT, config: { ...PG_DRAFT.config, user: "" } }))).rejects.toThrow(
      "User is required.",
    );
  });

  it("givenConnectedDatasource_whenDeleted_thenEngineStoppedSecretsClearedAndBroadcast", async () => {
    const { dependencies, changes, service: datasources } = await service();
    const saved = await datasources.save(saving(PG_DRAFT, SECRET));
    await datasources.connect(saved.id, {}, WINDOW);

    const deleting = datasources.delete(saved.id);
    dependencies.forked[0]?.exit(0);
    await deleting;

    expect(datasources.list().datasources).toEqual([]);
    expect(changes.at(-1)?.datasources).toEqual([]);
  });

  it("givenDatasourceWithConsoles_whenDeleted_thenItsConsoleDirectoryIsRemoved", async () => {
    const { files, service: datasources } = await service();
    const saved = await datasources.save(saving(PG_DRAFT));
    const consoles = createConsoleFiles({ directory: DIRECTORY, files });
    await consoles.write(saved.id, "console", "SELECT 1");
    await consoles.write("other", "console", "SELECT 2");

    await datasources.delete(saved.id);

    expect(await consoles.list(saved.id)).toEqual([]);
    expect(await consoles.list("other")).toEqual(["console"]);
  });

  it("givenEphemeralDatasource_whenListed_thenFirstNeverSavedAndWithoutSecret", async () => {
    const ephemeral = { id: "pg", pluginId: "postgres", config: { ...PG_DRAFT.config, password: SECRET } };
    const { files, dependencies, service: datasources } = await service({ ephemeral });

    const [listed] = datasources.list().datasources;
    await datasources.connect("pg", {}, WINDOW);

    expect(listed).toMatchObject({ id: "pg", name: "pg", ephemeral: true });
    expect(JSON.stringify(listed)).not.toContain(SECRET);
    expect(files.contents.size).toBe(0);
    expect(bootedConfig(dependencies)).toEqual({
      id: "pg",
      pluginId: "postgres",
      config: ephemeral.config,
      readOnly: false,
    });
    await expect(datasources.save({ datasource: { ...PG_DRAFT, id: "pg" }, secrets: {} })).rejects.toThrow(
      "TABLE_CRAFT_DATASOURCE",
    );
  });
});
