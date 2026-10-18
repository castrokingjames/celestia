// grant.ts — set an account's role (bootstrap the first `ignis`, promote others). This is an admin/ops
// action, invoked by a SERVER-LOCAL CLI (scripts/grant.ts) that needs DB access — there is no network path
// and no shareable secret that grants a role (G11). Login never lands here. Data access via the one
// Repository, never Kysely directly (G7).
import type { Repository } from "@celestia/firmament";

export interface GrantResult {
  accountId: string;
  handle: string | null;
  from: string;
  to: string;
}

type Store = Pick<Repository, "getRole" | "findAccountByHandleOrId" | "setAccountRole">;

/**
 * Set `account.role` for the account matched by handle (or id). Throws if the role is unknown or
 * reserved (role.active = false → activate it first), or if no account matches.
 */
export async function grantRole(repo: Store, identifier: string, role: string): Promise<GrantResult> {
  const r = await repo.getRole(role);
  if (!r) throw new Error(`unknown role '${role}'`);
  if (!r.active) throw new Error(`role '${role}' is reserved (active=false) — activate it before granting`);

  const acct = await repo.findAccountByHandleOrId(identifier);
  if (!acct) throw new Error(`no account with handle or id '${identifier}'`);

  await repo.setAccountRole(acct.id, role);
  return { accountId: acct.id, handle: acct.handle, from: acct.role, to: role };
}
