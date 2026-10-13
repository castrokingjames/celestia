// grant.ts — set an account's role (bootstrap the first `ignis`, promote others). This is an
// admin/ops action, invoked by a SERVER-LOCAL CLI (scripts/grant.ts) that needs DB access — there
// is no network path and no shareable secret that grants a role (G11). Login never lands here.
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GrantResult {
  accountId: string;
  handle: string | null;
  from: string;
  to: string;
}

/**
 * Set `account.role` for the account matched by handle (or id). Throws if the role is unknown or
 * reserved (role.active = false → activate it first), or if no account matches.
 */
export async function grantRole(db: Kysely<Database>, identifier: string, role: string): Promise<GrantResult> {
  const r = await db.selectFrom("role").select(["id", "active"]).where("id", "=", role).executeTakeFirst();
  if (!r) throw new Error(`unknown role '${role}'`);
  if (!r.active) throw new Error(`role '${role}' is reserved (active=false) — activate it before granting`);

  // Resolve by handle first; only try id if it looks like a uuid (avoids a Postgres uuid-cast error).
  let acct = await db
    .selectFrom("account")
    .select(["id", "handle", "role"])
    .where("handle", "=", identifier)
    .executeTakeFirst();
  if (!acct && UUID_RE.test(identifier)) {
    acct = await db
      .selectFrom("account")
      .select(["id", "handle", "role"])
      .where("id", "=", identifier)
      .executeTakeFirst();
  }
  if (!acct) throw new Error(`no account with handle or id '${identifier}'`);

  await db.updateTable("account").set({ role, updated_at: new Date() }).where("id", "=", acct.id).execute();
  return { accountId: acct.id, handle: acct.handle, from: acct.role, to: role };
}
