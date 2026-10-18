-- 0002_character.sql — Celestia character model (P1.5). See docs/CHARACTERS.md.
--
-- The per-(account,game) "save": account is PLATFORM-GLOBAL (login/ban); a CHARACTER is the PER_PLAYER
-- avatar inside one game (docs/PLATFORM.md §6). Engine-owned IDENTITY only — `name` is the single
-- player-facing attribute the engine knows; class/appearance/stats/inventory are MODULE-owned tables keyed
-- by game_character.id in a mod_<game>.* schema, NEVER columns here (G3: engine ↛ game module).
--
-- Table is `game_character` because bare `character` is a SQL reserved word.
--
-- SEAM (not built now): one game, one DB today, so game_id + the per-game data plane of PLATFORM §6 are
-- deferred — a character becomes keyed by (account_id, game_id) in a per-game DB when game #2 lands.

create table game_character (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references account(id) on delete cascade,
  name        text not null unique,
  status      text not null default 'active' check (status in ('active', 'deleted')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index game_character_account_idx on game_character (account_id);

-- character_placement — hot world-state, written every autosave by Atlas; its own row (1:1 with the
-- character) so the near-immutable identity above is not churned. The running world (Atlas) owns this;
-- meta (Polaris) owns the identity. NULL x/y = "use the zone's default spawn" (a fresh character).
create table character_placement (
  character_id  uuid primary key references game_character(id) on delete cascade,
  zone_id       text not null,
  x             double precision,
  y             double precision,
  updated_at    timestamptz not null default now()
);
