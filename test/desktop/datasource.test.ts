import { describe, expect, it } from "vitest";
import { DATASOURCE_ENV, DatasourceEnvError, datasourceFromEnvironment } from "@table-craft/desktop/main/datasource.js";

const POSTGRES = { id: "pg", pluginId: "postgres", config: { host: "127.0.0.1", database: "d", user: "u" } };

describe("datasource from the environment", () => {
  it("givenDatasourceEnv_whenMainStarts_thenUsesItsPlugin", () => {
    expect(datasourceFromEnvironment({ [DATASOURCE_ENV]: JSON.stringify(POSTGRES) })).toEqual(POSTGRES);
  });

  it("givenNoDatasourceEnv_whenMainStarts_thenAddsNoEphemeralDatasource", () => {
    expect(datasourceFromEnvironment({})).toBeNull();
    expect(datasourceFromEnvironment({ [DATASOURCE_ENV]: "  " })).toBeNull();
  });

  it("givenMalformedJson_whenMainStarts_thenThrowsNamingTheVariable", () => {
    expect(() => datasourceFromEnvironment({ [DATASOURCE_ENV]: "{not json" })).toThrow(DatasourceEnvError);
    expect(() => datasourceFromEnvironment({ [DATASOURCE_ENV]: "{not json" })).toThrow(DATASOURCE_ENV);
  });

  it("givenJsonWithoutPluginId_whenMainStarts_thenThrows", () => {
    expect(() => datasourceFromEnvironment({ [DATASOURCE_ENV]: JSON.stringify({ id: "x", config: {} }) })).toThrow(
      DatasourceEnvError,
    );
  });
});
