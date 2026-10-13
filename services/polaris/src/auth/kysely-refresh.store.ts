// kysely-refresh.store.ts — Kysely adapter for RefreshStore. Named only here + at the composition
// root; SessionService depends on the port.
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.js";
import type { RefreshRecord, RefreshStore } from "./refresh.store.js";

export class KyselyRefreshStore implements RefreshStore {
  constructor(private readonly db: Kysely<Database>) {}

  async create(accountId: string, tokenHash: string, expiresAt: Date): Promise<string> {
    const row = await this.db
      .insertInto("refresh_token")
      .values({ account_id: accountId, token_hash: tokenHash, expires_at: expiresAt })
      .returning("id")
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async findByHash(tokenHash: string): Promise<RefreshRecord | null> {
    const row = await this.db
      .selectFrom("refresh_token")
      .select(["id", "account_id", "expires_at", "revoked_at", "rotated_to"])
      .where("token_hash", "=", tokenHash)
      .executeTakeFirst();
    if (!row) return null;
    return {
      id: row.id,
      accountId: row.account_id,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      rotatedTo: row.rotated_to,
    };
  }

  async rotate(oldId: string, accountId: string, newTokenHash: string, expiresAt: Date): Promise<string> {
    return this.db.transaction().execute(async (tx) => {
      const next = await tx
        .insertInto("refresh_token")
        .values({ account_id: accountId, token_hash: newTokenHash, expires_at: expiresAt })
        .returning("id")
        .executeTakeFirstOrThrow();
      await tx
        .updateTable("refresh_token")
        .set({ revoked_at: new Date(), rotated_to: next.id })
        .where("id", "=", oldId)
        .execute();
      return next.id;
    });
  }

  async revokeByHash(tokenHash: string): Promise<void> {
    await this.db
      .updateTable("refresh_token")
      .set({ revoked_at: new Date() })
      .where("token_hash", "=", tokenHash)
      .where("revoked_at", "is", null)
      .execute();
  }

  async revokeAllForAccount(accountId: string): Promise<void> {
    await this.db
      .updateTable("refresh_token")
      .set({ revoked_at: new Date() })
      .where("account_id", "=", accountId)
      .where("revoked_at", "is", null)
      .execute();
  }
}
