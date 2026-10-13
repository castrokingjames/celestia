// refresh.store.ts — persistence PORT for refresh tokens (guardrail #7). SessionService depends
// on this interface, not Kysely. Only token HASHES are ever stored; the raw token is returned to
// the client once and never persisted.
export interface RefreshRecord {
  readonly id: string;
  readonly accountId: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly rotatedTo: string | null; // non-null = already exchanged; presenting it again = reuse
}

export interface RefreshStore {
  /** Store a new refresh-token hash for an account; returns the row id. */
  create(accountId: string, tokenHash: string, expiresAt: Date): Promise<string>;
  /** Look up a refresh token by its hash. */
  findByHash(tokenHash: string): Promise<RefreshRecord | null>;
  /** Atomically: insert the replacement, revoke the old one and point rotated_to at the new id. */
  rotate(oldId: string, accountId: string, newTokenHash: string, expiresAt: Date): Promise<string>;
  /** Revoke a single refresh token by its hash if still live (idempotent; no-op if unknown). Logout. */
  revokeByHash(tokenHash: string): Promise<void>;
  /** Revoke every still-live refresh token for an account (reuse/theft response). */
  revokeAllForAccount(accountId: string): Promise<void>;
}
