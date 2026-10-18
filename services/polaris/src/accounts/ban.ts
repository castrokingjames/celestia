// ban.ts — set an account's STATUS (ban / suspend / unban). An admin/ops action via a SERVER-LOCAL CLI
// (scripts/ban.ts): no network path, no shareable secret (G11), mirroring grant.ts. Polaris is the SOLE writer
// of account.status (0003 GRANTs give polaris_app UPDATE on account; atlas_app can only READ it) — this is what
// makes the no-RPC coordination legal. Setting a NON-ACTIVE status also burns the account's whole refresh chain
// in the same op, so re-entry dies immediately at every gate (login / refresh / lobby / zone). Data access via
// the one Repository, never Kysely directly (G7).
import type { Repository } from "@celestia/firmament";

export type AccountStatus = "active" | "suspended" | "banned";
const STATUSES: readonly AccountStatus[] = ["active", "suspended", "banned"];

export interface BanResult {
  accountId: string;
  handle: string | null;
  to: AccountStatus;
}

type Store = Pick<Repository, "findAccountByHandleOrId" | "setAccountStatus" | "revokeAllRefreshForAccount">;

/**
 * Set `account.status` for the account matched by handle (or id). `active` is the unban path. Throws if the
 * status is invalid or no account matches. For any non-active status, the refresh chain is burned so the ban
 * cannot be out-run by an in-flight refresh.
 */
export async function banAccount(repo: Store, identifier: string, status: AccountStatus): Promise<BanResult> {
  if (!STATUSES.includes(status)) {
    throw new Error(`invalid status '${status}' (expected one of ${STATUSES.join("|")})`);
  }
  const acct = await repo.findAccountByHandleOrId(identifier);
  if (!acct) throw new Error(`no account with handle or id '${identifier}'`);

  await repo.setAccountStatus(acct.id, status);
  if (status !== "active") await repo.revokeAllRefreshForAccount(acct.id); // kill re-entry immediately
  return { accountId: acct.id, handle: acct.handle, to: status };
}
