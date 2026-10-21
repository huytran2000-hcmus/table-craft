import { z } from "@table-craft/plugin-api";
import type { EphemeralDatasource } from "@table-craft/desktop/main/service.js";

/**
 * A JSON `{id, pluginId, config}`: one extra datasource that is listed but never written to disk,
 * its secrets kept until restart (decision 018, as amended by plan 004).
 */
export const DATASOURCE_ENV = "TABLE_CRAFT_DATASOURCE";

const datasourceSchema = z.strictObject({
  id: z.string().min(1),
  pluginId: z.string().min(1),
  config: z.unknown(),
});

export class DatasourceEnvError extends Error {
  override readonly name = "DatasourceEnvError";
}

/**
 * The datasource named by `TABLE_CRAFT_DATASOURCE`, or null when it is unset. A value that is set
 * but unreadable throws rather than being ignored, because the caller asked for a specific
 * database. The plugin's own schema checks `config` at connect time.
 */
export function datasourceFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): EphemeralDatasource | null {
  const raw = env[DATASOURCE_ENV];
  if (raw === undefined || raw.trim() === "") return null;
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
