import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { POSTGRES_CONFIG } from "../support/databases.js";

/** The demo shop's database inside the `test:db` PostgreSQL container, beside the fixture one. */
export const SHOP_DATABASE = "shop";
export const SHOP_SQLITE_FILE = "shop.db";

const COMPOSE_FILE = new URL("../db/compose.yml", import.meta.url).pathname;
const POSTGRES_SEED = new URL("./shop.postgres.sql", import.meta.url);
const SQLITE_SEED = new URL("./shop.sqlite.sql", import.meta.url);
const POSTGRES_SERVICE = "postgres";
/** The maintenance database psql connects to while `shop` is dropped and re-created. */
const MAINTENANCE_DATABASE = "postgres";

function psql(database: string, args: string[], input?: string): void {
  execFileSync(
    "docker",
    [
      "compose",
      "-f",
      COMPOSE_FILE,
      "exec",
      "-T",
      POSTGRES_SERVICE,
      "psql",
      "-U",
      POSTGRES_CONFIG.user,
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
      ...args,
    ],
    { input, stdio: ["pipe", "ignore", "pipe"] },
  );
}

/**
 * Drops and re-creates `shop` in the `test:db` container from `shop.postgres.sql`, so every
 * recording starts from the same rows whatever the previous one wrote. `WITH (FORCE)` closes the
 * sessions a crashed run may have left open.
 */
export function loadShopPostgres(): void {
  psql(MAINTENANCE_DATABASE, [
    "-c",
    `DROP DATABASE IF EXISTS ${SHOP_DATABASE} WITH (FORCE)`,
    "-c",
    `CREATE DATABASE ${SHOP_DATABASE}`,
  ]);
  psql(SHOP_DATABASE, [], readFileSync(POSTGRES_SEED, "utf8"));
}

/** Writes `shop.db` into `directory` from `shop.sqlite.sql` and returns its path. */
export function buildShopSqlite(directory: string): string {
  const path = join(directory, SHOP_SQLITE_FILE);
  const database = new DatabaseSync(path);
  try {
    database.exec(readFileSync(SQLITE_SEED, "utf8"));
  } finally {
    database.close();
  }
  return path;
}
