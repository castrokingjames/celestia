// migrate.ts — minimal forward-only migration runner. Applies migrations/*.sql in filename
// order, each in its own transaction, recording applied files in schema_migrations so re-runs
// are idempotent. No down-migrations (roll forward). Run: pnpm --filter @celestia/polaris migrate
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { config } from "../config.js";

const migrationsUrl = new URL("../../migrations/", import.meta.url);

async function run(): Promise<void> {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const client = await pool.connect();
  try {
    await client.query(
      `create table if not exists schema_migrations (
         id text primary key,
         applied_at timestamptz not null default now()
       )`,
    );
    const { rows } = await client.query<{ id: string }>("select id from schema_migrations");
    const applied = new Set(rows.map((r) => r.id));

    const files = readdirSync(fileURLToPath(migrationsUrl))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`[migrate] skip   ${file}`);
        continue;
      }
      const sql = readFileSync(new URL(file, migrationsUrl), "utf8");
      console.log(`[migrate] apply  ${file}`);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (id) values ($1)", [file]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    }
    console.log("[migrate] up to date");
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
