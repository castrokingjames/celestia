// kysely-repository.ts — the ONE Kysely implementation of Repository, and the ONLY place in the entire
// codebase that imports the query-builder / writes a query. To move to Drizzle/Prisma/TypeORM, reimplement
// THIS file against the Repository interface — nothing else in the system changes. Column aliases map
// snake_case → camelCase at the query boundary so the ports stay camelCase.
import { sql, type Kysely } from "kysely";
import type { Database } from "./schema.js";
import type {
  Account,
  AccountRef,
  Character,
  EventRow,
  PrecedentMatch,
  RefreshRecord,
  Repository,
  RoleRow,
  SpawnData,
} from "./repository.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAR_COLS = ["id", "account_id as accountId", "name", "status"] as const;

/** A JS number[] → the pgvector text literal `[a,b,c]` (cast `::vector` in SQL). */
const toVector = (e: readonly number[]): string => `[${e.join(",")}]`;

export class KyselyRepository implements Repository {
  constructor(private readonly db: Kysely<Database>) {}

  // ── accounts ────────────────────────────────────────────────────────────
  async findAccountByIdentity(method: string, externalId: string): Promise<Account | null> {
    const row = await this.db
      .selectFrom("auth_identity")
      .innerJoin("account", "account.id", "auth_identity.account_id")
      .select(["account.id", "account.handle", "account.role", "account.status"])
      .where("auth_identity.method", "=", method)
      .where("auth_identity.external_id", "=", externalId)
      .executeTakeFirst();
    return row ?? null;
  }

  async getAccountById(id: string): Promise<Account | null> {
    const row = await this.db
      .selectFrom("account")
      .select(["id", "handle", "role", "status"])
      .where("id", "=", id)
      .executeTakeFirst();
    return row ?? null;
  }

  async createAccountWithIdentity(identity: { method: string; externalId: string; secretHash?: string }): Promise<Account> {
    return this.db.transaction().execute(async (tx) => {
      // handle stays null here: it's a deliberate onboarding choice, NOT derived from the login. role/status
      // fall to DB defaults ('terra'/'active'). secret_hash is set only for self-credentialed methods (`password`),
      // null otherwise (shared-secret/IdP methods carry no per-identity secret).
      const account = await tx
        .insertInto("account")
        .values({ handle: null })
        .returning(["id", "handle", "role", "status"])
        .executeTakeFirstOrThrow();
      await tx
        .insertInto("auth_identity")
        .values({
          account_id: account.id,
          method: identity.method,
          external_id: identity.externalId,
          secret_hash: identity.secretHash ?? null,
        })
        .execute();
      return account;
    });
  }

  async getIdentitySecretHash(method: string, externalId: string): Promise<string | null> {
    const row = await this.db
      .selectFrom("auth_identity")
      .select(["secret_hash"])
      .where("method", "=", method)
      .where("external_id", "=", externalId)
      .executeTakeFirst();
    return row?.secret_hash ?? null;
  }

  async setAccountStatus(id: string, status: string): Promise<void> {
    await this.db.updateTable("account").set({ status, updated_at: new Date() }).where("id", "=", id).execute();
  }

  async getAccountStatuses(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .selectFrom("account")
      .select(["id", "status"])
      .where("id", "in", [...ids])
      .execute();
    return new Map(rows.map((r) => [r.id, r.status]));
  }

  // ── characters ──────────────────────────────────────────────────────────
  async listCharacters(accountId: string): Promise<Character[]> {
    return this.db
      .selectFrom("game_character")
      .select(CHAR_COLS)
      .where("account_id", "=", accountId)
      .where("status", "=", "active")
      .orderBy("created_at", "asc")
      .execute();
  }

  async countCharacters(accountId: string): Promise<number> {
    const row = await this.db
      .selectFrom("game_character")
      .select((eb) => eb.fn.countAll().as("n"))
      .where("account_id", "=", accountId)
      .where("status", "=", "active")
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  async createCharacter(accountId: string, name: string): Promise<Character> {
    return this.db
      .insertInto("game_character")
      .values({ account_id: accountId, name })
      .returning(CHAR_COLS)
      .executeTakeFirstOrThrow();
  }

  async getOwnedCharacter(accountId: string, characterId: string): Promise<Character | null> {
    const row = await this.db
      .selectFrom("game_character")
      .select(CHAR_COLS)
      .where("id", "=", characterId)
      .where("account_id", "=", accountId)
      .where("status", "=", "active")
      .executeTakeFirst();
    return row ?? null;
  }

  // ── refresh tokens ────────────────────────────────────────────────────────
  async createRefresh(accountId: string, tokenHash: string, expiresAt: Date): Promise<string> {
    const row = await this.db
      .insertInto("refresh_token")
      .values({ account_id: accountId, token_hash: tokenHash, expires_at: expiresAt })
      .returning("id")
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async findRefreshByHash(tokenHash: string): Promise<RefreshRecord | null> {
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

  async rotateRefresh(oldId: string, accountId: string, newTokenHash: string, expiresAt: Date): Promise<string> {
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

  async revokeRefreshByHash(tokenHash: string): Promise<void> {
    await this.db
      .updateTable("refresh_token")
      .set({ revoked_at: new Date() })
      .where("token_hash", "=", tokenHash)
      .where("revoked_at", "is", null)
      .execute();
  }

  async revokeAllRefreshForAccount(accountId: string): Promise<void> {
    await this.db
      .updateTable("refresh_token")
      .set({ revoked_at: new Date() })
      .where("account_id", "=", accountId)
      .where("revoked_at", "is", null)
      .execute();
  }

  // ── placement ─────────────────────────────────────────────────────────────
  async loadSpawn(characterId: string): Promise<SpawnData | null> {
    const row = await this.db
      .selectFrom("game_character")
      .leftJoin("character_placement", "character_placement.character_id", "game_character.id")
      .select([
        "game_character.name as name",
        "character_placement.zone_id as zoneId",
        "character_placement.x as x",
        "character_placement.y as y",
      ])
      .where("game_character.id", "=", characterId)
      .where("game_character.status", "=", "active")
      .executeTakeFirst();
    return row ?? null;
  }

  async savePlacement(characterId: string, zoneId: string, x: number, y: number): Promise<void> {
    await this.db
      .insertInto("character_placement")
      .values({ character_id: characterId, zone_id: zoneId, x, y })
      .onConflict((oc) => oc.column("character_id").doUpdateSet({ zone_id: zoneId, x, y, updated_at: new Date() }))
      .execute();
  }

  // ── role admin (grant CLI) ──────────────────────────────────────────────
  async getRole(id: string): Promise<RoleRow | null> {
    const row = await this.db.selectFrom("role").select(["id", "active"]).where("id", "=", id).executeTakeFirst();
    return row ?? null;
  }

  async findAccountByHandleOrId(identifier: string): Promise<AccountRef | null> {
    // Resolve by handle first; only try id if it looks like a uuid (avoids a Postgres uuid-cast error).
    let acct = await this.db
      .selectFrom("account")
      .select(["id", "handle", "role"])
      .where("handle", "=", identifier)
      .executeTakeFirst();
    if (!acct && UUID_RE.test(identifier)) {
      acct = await this.db
        .selectFrom("account")
        .select(["id", "handle", "role"])
        .where("id", "=", identifier)
        .executeTakeFirst();
    }
    return acct ?? null;
  }

  async setAccountRole(id: string, role: string): Promise<void> {
    await this.db.updateTable("account").set({ role, updated_at: new Date() }).where("id", "=", id).execute();
  }

  // ── event log (append-only; schema-qualified "log.event" → "log"."event") ────
  async appendEvent(row: EventRow): Promise<void> {
    await this.db
      .insertInto("log.event")
      .values({
        stream: row.stream,
        seq: row.seq,
        prev_hash: row.prevHash,
        hash: row.hash,
        type: row.type,
        at: row.at,
        actor: row.actor, // jsonb — node-postgres serializes the object
        data: row.data,
      })
      .execute();
  }

  async getEventChainHead(stream: string): Promise<{ seq: number; hash: string } | null> {
    const row = await this.db
      .selectFrom("log.event")
      .select(["seq", "hash"])
      .where("stream", "=", stream)
      .orderBy("seq", "desc")
      .limit(1)
      .executeTakeFirst();
    return row ? { seq: Number(row.seq), hash: row.hash } : null; // bigint seq → Number at the boundary
  }

  async readEventStream(stream: string): Promise<EventRow[]> {
    const rows = await this.db
      .selectFrom("log.event")
      .select(["stream", "seq", "prev_hash", "hash", "type", "at", "actor", "data"])
      .where("stream", "=", stream)
      .orderBy("seq", "asc")
      .execute();
    return rows.map((r) => ({
      stream: r.stream,
      seq: Number(r.seq),
      prevHash: r.prev_hash,
      hash: r.hash,
      type: r.type,
      at: Number(r.at),
      actor: r.actor as Record<string, unknown>,
      data: r.data as Record<string, unknown>,
    }));
  }

  // ── decision precedents (pgvector nearest-neighbour; "memory"."precedent") ───
  async seedPrecedents(
    schemaKey: string,
    rows: readonly { embedding: number[]; action: string }[],
  ): Promise<void> {
    // Replace this schema's rows so re-seeding (every room create) converges to the current seed set — not append.
    await this.db.transaction().execute(async (tx) => {
      await tx.deleteFrom("memory.precedent").where("schema_key", "=", schemaKey).execute();
      if (rows.length === 0) return;
      await tx
        .insertInto("memory.precedent")
        .values(
          rows.map((r) => ({
            schema_key: schemaKey,
            action: r.action,
            embedding: sql<string>`${toVector(r.embedding)}::vector`,
          })),
        )
        .execute();
    });
  }

  async nearestPrecedents(schemaKey: string, embedding: number[], k: number): Promise<PrecedentMatch[]> {
    // pgvector cosine DISTANCE (`<=>`, vector_cosine_ops) ∈ [0,2]; similarity = 1 − distance (matches the
    // in-memory cosine store). Reuse the same expression for SELECT + ORDER BY so there's one source of truth.
    const distance = sql<number>`embedding <=> ${toVector(embedding)}::vector`;
    const rows = await this.db
      .selectFrom("memory.precedent")
      .select("action")
      .select(distance.as("distance"))
      .where("schema_key", "=", schemaKey)
      .orderBy(distance, "asc")
      .limit(k)
      .execute();
    return rows.map((r) => ({ action: r.action, score: 1 - Number(r.distance) }));
  }
}
