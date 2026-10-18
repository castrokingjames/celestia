// client.ts — the one place that constructs a Kysely<Database> over node-postgres. Callers depend on
// Kysely<Database>; only a composition root (PersistenceModule) / scripts / tests call createDb.
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { Database } from "./schema.js";
import { config } from "../config/config.js";

export function createDb(connectionString: string = config.databaseUrl): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString }) }),
  });
}
