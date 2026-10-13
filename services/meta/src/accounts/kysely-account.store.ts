// kysely-account.store.ts — the Kysely adapter for AccountStore. Named only here + at the
// composition root; the rest of meta depends on the AccountStore port.
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.js";
import type { VerifiedIdentity } from "../auth/auth-method.port.js";
import type { Account, AccountStore } from "./account.store.js";

export class KyselyAccountStore implements AccountStore {
  constructor(private readonly db: Kysely<Database>) {}

  async findByIdentity(method: string, externalId: string): Promise<Account | null> {
    const row = await this.db
      .selectFrom("auth_identity")
      .innerJoin("account", "account.id", "auth_identity.account_id")
      .select(["account.id", "account.handle", "account.role", "account.status"])
      .where("auth_identity.method", "=", method)
      .where("auth_identity.external_id", "=", externalId)
      .executeTakeFirst();
    return row ?? null;
  }

  async getById(id: string): Promise<Account | null> {
    const row = await this.db
      .selectFrom("account")
      .select(["id", "handle", "role", "status"])
      .where("id", "=", id)
      .executeTakeFirst();
    return row ?? null;
  }

  async createWithIdentity(identity: VerifiedIdentity): Promise<Account> {
    return this.db.transaction().execute(async (tx) => {
      const account = await tx
        .insertInto("account")
        // handle stays null here: it's a deliberate player choice in onboarding, NOT derived from
        // the login (deriving it would collide across identities and pre-claim names). role/status
        // fall to DB defaults ('terra'/'active'). identity.suggestedHandle is only a UI hint later.
        .values({ handle: null })
        .returning(["id", "handle", "role", "status"])
        .executeTakeFirstOrThrow();
      await tx
        .insertInto("auth_identity")
        .values({
          account_id: account.id,
          method: identity.method,
          external_id: identity.externalId,
        })
        .execute();
      return account;
    });
  }
}
