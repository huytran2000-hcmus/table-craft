import { z } from "@table-craft/plugin-api";
import type { DatasourceConfig } from "@table-craft/desktop/engine/protocol.js";

/** A JSON `DatasourceConfig`; the dev and test seam until the connection form lands (decision 018). */
export const DATASOURCE_ENV = "TABLE_CRAFT_DATASOURCE";

/** Without the variable, every window talks to one private in-memory SQLite database. */
export const SCRATCH_DATASOURCE: DatasourceConfig = { id: "scratch", pluginId: "sqlite", config: { path: ":memory:" } };

const datasourceSchema = z.strictObject({
  id: z.string().min(1),
  pluginId: z.string().min(1),
  config: z.unknown(),
});

export class DatasourceEnvError extends Error {
  override readonly name = "DatasourceEnvError";
}

/**
 * The datasource named by `TABLE_CRAFT_DATASOURCE`, or the scratch database when it is unset.
 * A value that is set but unreadable throws rather than silently falling back, because the
 * caller asked for a specific database. The plugin's own schema checks `config` at connect time.
 */
export function datasourceFromEnvironment(env: Readonly<Record<string, string | undefined>>): DatasourceConfig {
  const raw = env[DATASOURCE_ENV];
  if (raw === undefined || raw.trim() === "") return SCRATCH_DATASOURCE;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (cause) {
    throw new DatasourceEnvError(`${DATASOURCE_ENV} is not JSON; set it to {"id", "pluginId", "config"} or unset it.`, {
      cause,
    });
  }
  const parsed = datasourceSchema.safeParse(json);
  if (!parsed.success) {
    throw new DatasourceEnvError(
      `${DATASOURCE_ENV} must be {"id", "pluginId", "config"}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
  return parsed.data;
}
