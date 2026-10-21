// repository.ts — the ONE data-access PORT. Every DB operation in the system is a method here, and its ONLY
// implementation (kysely-repository.ts) is the ONLY place the query-builder is ever imported. Domains inject
// the REPOSITORY token (from "@celestia/firmament/nest") and depend on THIS interface — never on Kysely, never
// a raw query. Swapping the ORM (Drizzle/Prisma/TypeORM/…) = reimplement the one adapter against this
// interface; zero changes anywhere else. (Table write-ownership is enforced separately by per-service DB
// GRANTs — docs/PIPELINE.md §3; this interface is the ORM boundary, not the authority boundary.)

/** The durable principal (account), as callers see it. */
export interface Account {
  readonly id: string;
  readonly handle: string | null;
  readonly role: string;
  readonly status: string;
}

/** A character — ENGINE identity only (id/name); game attributes are module-owned tables keyed by id. */
export interface Character {
  readonly id: string;
  readonly accountId: string;
  readonly name: string;
  readonly status: string;
}

/** A refresh-token record (only hashes are stored; the raw token is returned once and never persisted). */
export interface RefreshRecord {
  readonly id: string;
  readonly accountId: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly rotatedTo: string | null; // non-null = already exchanged; presenting it again = reuse
}

/** A character's spawn: display name + last placement (null x/y = use the zone's default spawn). */
export interface SpawnData {
  readonly name: string;
  readonly zoneId: string | null;
  readonly x: number | null;
  readonly y: number | null;
}

/** A durable event row (append-only event-sourced truth — G4). The hash chain links rows per `stream`:
 *  hash = sha256(prevHash || canonical(payload)); seq is per-stream, 1-based, gapless. */
export interface EventRow {
  readonly stream: string;
  readonly seq: number;
  readonly prevHash: string;
  readonly hash: string;
  readonly type: string;
  readonly at: number;
  readonly actor: Record<string, unknown>;
  readonly data: Record<string, unknown>;
}

/** A role definition (for the server-local grant CLI). */
export interface RoleRow {
  readonly id: string;
  readonly active: boolean;
}

/** One retrieved decision precedent: the action it recorded + its similarity (0..1) to the query embedding
 *  (cosine; 1 = identical). DECISIONS §2 tier-1. */
export interface PrecedentMatch {
  readonly action: string;
  readonly score: number;
}

/** Minimal account view the grant CLI resolves (by handle or id). */
export interface AccountRef {
  readonly id: string;
  readonly handle: string | null;
  readonly role: string;
}

/** The single data-access surface. Grouped by domain, but one interface, one adapter, one ORM boundary. */
export interface Repository {
  // ── accounts ──────────────────────────────────────────────────────────────
  findAccountByIdentity(method: string, externalId: string): Promise<Account | null>;
  getAccountById(id: string): Promise<Account | null>;
  createAccountWithIdentity(identity: { method: string; externalId: string; secretHash?: string }): Promise<Account>;
  /** The per-identity stored credential (auth_identity.secret_hash) for methods that own one (e.g. `password`),
   *  or null if the identity doesn't exist yet (first login) or stores no secret. AUTHENTICATION-scoped read —
   *  it never exposes account/role/privilege. */
  getIdentitySecretHash(method: string, externalId: string): Promise<string | null>;
  setAccountStatus(id: string, status: string): Promise<void>; // Polaris write lane: ban / suspend / unban
  getAccountStatuses(ids: readonly string[]): Promise<Map<string, string>>; // Atlas batch read: revocation sweep

  // ── characters ────────────────────────────────────────────────────────────
  listCharacters(accountId: string): Promise<Character[]>;
  countCharacters(accountId: string): Promise<number>;
  createCharacter(accountId: string, name: string): Promise<Character>;
  getOwnedCharacter(accountId: string, characterId: string): Promise<Character | null>;

  // ── refresh tokens ──────────────────────────────────────────────────────────
  createRefresh(accountId: string, tokenHash: string, expiresAt: Date): Promise<string>;
  findRefreshByHash(tokenHash: string): Promise<RefreshRecord | null>;
  rotateRefresh(oldId: string, accountId: string, newTokenHash: string, expiresAt: Date): Promise<string>;
  revokeRefreshByHash(tokenHash: string): Promise<void>;
  revokeAllRefreshForAccount(accountId: string): Promise<void>;

  // ── placement (game state; GRANTs scope which service may actually write) ────
  loadSpawn(characterId: string): Promise<SpawnData | null>;
  savePlacement(characterId: string, zoneId: string, x: number, y: number): Promise<void>;

  // ── role admin (server-local grant CLI; no network path — G11) ──────────────
  getRole(id: string): Promise<RoleRow | null>;
  findAccountByHandleOrId(identifier: string): Promise<AccountRef | null>;
  setAccountRole(id: string, role: string): Promise<void>;

  // ── event log (append-only, event-sourced truth — G4; Atlas-owned) ──────────
  appendEvent(row: EventRow): Promise<void>;
  getEventChainHead(stream: string): Promise<{ seq: number; hash: string } | null>;
  readEventStream(stream: string): Promise<EventRow[]>;

  // ── decision precedents (DECISIONS §2 tier-1; pgvector nearest-neighbour; Atlas-owned) ──
  /** Replace a schema's seeded precedents (embeddings already computed by the caller). Replace, not append, so
   *  re-seeding on every room create converges to the current seed set. */
  seedPrecedents(schemaKey: string, rows: readonly { embedding: number[]; action: string }[]): Promise<void>;
  /** The k nearest seeded precedents to a query embedding, by cosine similarity (highest first). */
  nearestPrecedents(schemaKey: string, embedding: number[], k: number): Promise<PrecedentMatch[]>;
}
