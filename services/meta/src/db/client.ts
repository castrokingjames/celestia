// client.ts — the one place that constructs a Kysely<Database> over node-postgres.
// Callers depend on Kysely<Database>; only the composition root (and tests) call createDb.
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { Database } from "./schema.js";
import { config } from "../config.js";

export function createDb(connectionString: string = config.databaseUrl): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString }) }),
  });
}
