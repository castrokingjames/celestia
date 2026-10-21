// schema.ts — Kysely row types for the SHARED Postgres (mirrors services/polaris/migrations/*.sql).
// Shared because both tiers touch the same DB: Polaris owns identity/characters; Atlas reads game_character
// + writes character_placement. Generated<T> = DB-supplied on insert (optional in inserts, present in selects).
import type { Generated } from "kysely";

export interface RoleTable {
  id: string;
  element: string;
  active: Generated<boolean>;
  description: string;
  created_at: Generated<Date>;
}

export interface AccountTable {
  id: Generated<string>;
  handle: string | null;
  role: Generated<string>; // default 'terra'
  status: Generated<string>; // default 'active'
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AuthIdentityTable {
  id: Generated<string>;
  account_id: string;
  method: string;
  external_id: string;
  secret_hash: string | null;
  created_at: Generated<Date>;
}

export interface RefreshTokenTable {
  id: Generated<string>;
  account_id: string;
  token_hash: string;
  issued_at: Generated<Date>;
  expires_at: Date;
  rotated_to: string | null;
  revoked_at: Date | null;
}

// game_character / character_placement — mirrors migrations/0002_character.sql.
// Engine IDENTITY only; game-specific attributes live in module-owned tables (docs/CHARACTERS.md §3).
export interface GameCharacterTable {
  id: Generated<string>;
  account_id: string;
  name: string;
  status: Generated<string>; // default 'active'
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface CharacterPlacementTable {
  character_id: string; // pk + fk → game_character.id (1:1)
  zone_id: string;
  x: number | null; // null = use the zone's default spawn
  y: number | null;
  updated_at: Generated<Date>;
}

// log.event — append-only event-sourced truth (G4); mirrors migrations/0004_event_log.sql. Atlas-owned
// (atlas_app has SELECT+INSERT only — no update/delete, so append-only is a Postgres permission). seq/at are
// bigint in Postgres (pg returns them as strings) → the adapter coerces via Number() at the boundary.
export interface EventLogTable {
  stream: string;
  seq: number;
  prev_hash: string;
  hash: string;
  type: string;
  at: number;
  actor: unknown; // jsonb — { accountId, characterId, role }
  data: unknown; // jsonb — event payload
  recorded_at: Generated<Date>; // storage wall-time (DB-set, outside the reducer; NOT hashed)
}

// memory.precedent — seeded decision precedents (DECISIONS §2 tier-1); mirrors migrations/0005_precedent.sql.
// `embedding` is a pgvector column: written as the bracketed text form cast `::vector`, and never SELECTed back
// (only its cosine distance to the query is), so modelling it as string suffices for the one adapter that writes
// it. `id` is a bigint identity (pg returns bigint as string). Atlas-owned (atlas_app has select/insert/delete).
export interface PrecedentTable {
  id: Generated<string>;
  schema_key: string;
  action: string;
  embedding: string; // pgvector; set via sql`[…]::vector`
  created_at: Generated<Date>;
}

export interface Database {
  role: RoleTable;
  account: AccountTable;
  auth_identity: AuthIdentityTable;
  refresh_token: RefreshTokenTable;
  game_character: GameCharacterTable;
  character_placement: CharacterPlacementTable;
  "log.event": EventLogTable; // schema-qualified key → Kysely emits "log"."event"
  "memory.precedent": PrecedentTable; // → "memory"."precedent"
}
