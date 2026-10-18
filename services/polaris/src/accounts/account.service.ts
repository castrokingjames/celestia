// account.service.ts — login IS registration. Resolve the account for a verified identity, creating it on
// first sight. New accounts land at role 'terra'; elevated roles (aqua/aer/ignis/...) are granted deliberately
// elsewhere, NEVER here (G11). `created` lets the caller route brand-new accounts into onboarding (handle
// choice, welcome) vs straight sign-in. Data access is the one Repository — never Kysely directly (G7).
import type { Account, Repository } from "@celestia/firmament";
import type { VerifiedIdentity } from "../auth/auth-method.port.js";

export interface FindOrCreateResult {
  account: Account;
  created: boolean;
}

type Store = Pick<Repository, "findAccountByIdentity" | "createAccountWithIdentity">;

export async function findOrCreateAccount(repo: Store, identity: VerifiedIdentity): Promise<FindOrCreateResult> {
  const existing = await repo.findAccountByIdentity(identity.method, identity.externalId);
  if (existing) return { account: existing, created: false };

  try {
    return { account: await repo.createAccountWithIdentity(identity), created: true };
  } catch (err) {
    // A concurrent first-login raced us; the unique(method, external_id) now exists — re-read it.
    const raced = await repo.findAccountByIdentity(identity.method, identity.externalId);
    if (raced) return { account: raced, created: false };
    throw err;
  }
}
