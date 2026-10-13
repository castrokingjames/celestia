// account.store.ts — the persistence PORT for accounts (guardrail #7). The find-or-create
// use-case depends on this interface, never on Kysely/pg directly; the composition root wires
// the concrete adapter (KyselyAccountStore). Swapping the DB layer touches only the adapter.
import type { VerifiedIdentity } from "../auth/auth-method.port.js";

/** The durable principal, as the rest of meta sees it. */
export interface Account {
  readonly id: string;
  readonly handle: string | null;
  readonly role: string;
  readonly status: string;
}

export interface AccountStore {
  /** The account linked to (method, externalId), or null if this identity is unseen. */
  findByIdentity(method: string, externalId: string): Promise<Account | null>;
  /** Create a new account (role defaults to 'terra') + its first auth_identity, atomically. */
  createWithIdentity(identity: VerifiedIdentity): Promise<Account>;
  /** Load an account by id — used to re-read authoritative role on refresh (never trust a claim). */
  getById(id: string): Promise<Account | null>;
}
