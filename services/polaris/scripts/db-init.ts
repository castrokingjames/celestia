// db-init.ts — one-time LOCAL dev bootstrap for the no-Docker setup (README "Local setup without Docker").
// Creates the login role + database that migrate.ts and the services connect THROUGH — the one thing migrate
// can't do itself (it connects AS that role, so the role + db must already exist). Idempotent: safe to re-run;
// realigns the role password every time so it stays in sync. DEV CONVENIENCE ONLY — mirrors the compose
// defaults; prod roles/db come from your platform, never this. Run: pnpm --filter @celestia/polaris db:init
//
// The TARGET (role/password/db) is read from DATABASE_URL — single source of truth — defaulting to the
// docker-compose.gaia.yml / .env.example value so it works even before you've written a .env. The ADMIN
// connection used to create them defaults to the maintenance `postgres` db on the same host as your OS user
// (passwordless local on Homebrew / Postgres.app). For the EDB installer, point it at the superuser you set:
//   ADMIN_DATABASE_URL=postgres://postgres:yourpw@localhost:5432/postgres pnpm --filter @celestia/polaris db:init
import { Pool } from "pg";

const DEFAULT_DATABASE_URL = "postgres://celestia:celestia@localhost:5432/celestia"; // matches docker-compose.gaia.yml

async function run(): Promise<void> {
  const target = new URL(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
  const role = decodeURIComponent(target.username);
  const password = decodeURIComponent(target.password);
  const dbName = target.pathname.replace(/^\//, "");
  if (!role || !dbName) throw new Error(`DATABASE_URL needs a role and database (got '${target.href}')`);

  const adminUrl = process.env.ADMIN_DATABASE_URL ?? `postgres://${target.hostname}:${target.port || "5432"}/postgres`;
  const admin = new Pool({ connectionString: adminUrl });
  try {
    // Role — CREATE ROLE has no IF NOT EXISTS; create if absent, else realign. format(%I,%L) safely quotes the
    // identifier + literal (DDL can't bind $-params), the same pattern migrate.ts setRolePasswords uses.
    const roleExists = ((await admin.query("select 1 from pg_roles where rolname = $1", [role])).rowCount ?? 0) > 0;
    const verb = roleExists ? "alter" : "create";
    const tmpl = password
      ? `${verb} role %I with login superuser password %L`
      : `${verb} role %I with login superuser`;
    const { rows } = await admin.query<{ stmt: string }>(
      `select format('${tmpl}', $1::text${password ? ", $2::text" : ""}) as stmt`,
      password ? [role, password] : [role],
    );
    await admin.query(rows[0].stmt);
    console.log(`[db-init] role '${role}' ${roleExists ? "updated" : "created"} (login superuser)`);

    // Database — can't be parameterized or run inside a transaction; create only if absent.
    const dbExists = ((await admin.query("select 1 from pg_database where datname = $1", [dbName])).rowCount ?? 0) > 0;
    if (dbExists) {
      console.log(`[db-init] database '${dbName}' already exists — skipped`);
    } else {
      const { rows: ddl } = await admin.query<{ stmt: string }>(
        "select format('create database %I owner %I', $1::text, $2::text) as stmt",
        [dbName, role],
      );
      await admin.query(ddl[0].stmt);
      console.log(`[db-init] created database '${dbName}' owned by '${role}'`);
    }
    console.log("[db-init] done. Next: pnpm --filter @celestia/polaris migrate");
  } finally {
    await admin.end();
  }
}

run().catch((err) => {
  console.error("[db-init] failed:", err);
  process.exit(1);
});
