// account.service.ts — login IS registration. Resolve the account for a verified identity,
// creating it on first sight. New accounts land at role 'terra'; elevated roles (aqua/aer/
// ignis/...) are granted deliberately elsewhere, NEVER here (G11). `created` lets the caller
// route brand-new accounts into onboarding (handle choice, welcome) vs straight sign-in.
import type { VerifiedIdentity } from "../auth/auth-method.port.js";
import type { Account, AccountStore } from "./account.store.js";

export interface FindOrCreateResult {
  account: Account;
  created: boolean;
}

export async function findOrCreateAccount(
  store: AccountStore,
  identity: VerifiedIdentity,
): Promise<FindOrCreateResult> {
  const existing = await store.findByIdentity(identity.method, identity.externalId);
  if (existing) return { account: existing, created: false };

  try {
    return { account: await store.createWithIdentity(identity), created: true };
  } catch (err) {
    // A concurrent first-login raced us; the unique(method, external_id) now exists — re-read it.
    const raced = await store.findByIdentity(identity.method, identity.externalId);
    if (raced) return { account: raced, created: false };
    throw err;
  }
}
