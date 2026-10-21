import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = new URL("../db/schema/sqlite.sql", import.meta.url);
const DATABASE_FILE = "fixture.sqlite";

/**
 * A file database seeded from `test/db/schema/sqlite.sql`. A file, not `:memory:`, because every
 * contract case opens its own session and an in-memory database dies with its connection.
 */
export function seededSqliteFile(): string {
  const path = join(mkdtempSync(join(tmpdir(), "table-craft-sqlite-")), DATABASE_FILE);
  const database = new DatabaseSync(path);
  try {
    database.exec(readFileSync(SCHEMA, "utf8"));
  } finally {
    database.close();
  }
  return path;
}
