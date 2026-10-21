/** Connection configs for the `test/db/compose.yml` databases, shared by `test:db` and the live test. */

const CREDENTIAL = "table_craft";
const WRONG_PASSWORD = "not-the-password";
const LOOPBACK = "127.0.0.1";

export const POSTGRES_CONFIG = {
  host: LOOPBACK,
  port: 55432,
  database: CREDENTIAL,
  user: CREDENTIAL,
  password: CREDENTIAL,
} as const;

export const MYSQL_CONFIG = {
  host: LOOPBACK,
  port: 53306,
  database: CREDENTIAL,
  user: CREDENTIAL,
  password: CREDENTIAL,
} as const;

export function withWrongPassword<Config extends { readonly password: string }>(config: Config): Config {
  return { ...config, password: WRONG_PASSWORD };
}
