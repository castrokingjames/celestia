-- 0004_event_log.sql — the durable, append-only, event-sourced truth (G4). Fulfils 0003's note "grant
-- atlas_app explicitly when log.event lands". Forward-only; run by src/db/migrate.ts as the admin/owner
-- DATABASE_URL, exactly like 0003. Atlas-owned.
--
-- One hash CHAIN per `stream` (= zone id today): hash = sha256(prev_hash || canonical(payload)); seq is
-- per-stream, 1-based, gapless. APPEND-ONLY is a Postgres PERMISSION, not prose — atlas_app gets SELECT+INSERT
-- only (NO update/delete), mirroring 0003's write-ownership model. The admin/owner is the only principal that
-- could ever create or mutate rows, which runtime never does.

create schema if not exists log;
grant usage on schema log to atlas_app;

create table log.event (
  stream      text        not null,                     -- chain scope = zone id now (per-shard stream key later)
  seq         bigint      not null,                      -- per-stream monotonic, starts at 1 (gapless)
  prev_hash   text        not null,                      -- hex sha256 of the prior row; GENESIS constant at seq=1
  hash        text        not null,                      -- sha256(prev_hash || canonical(payload))
  type        text        not null,                      -- GameEvent.type (e.g. lever_toggled)
  at          bigint      not null,                      -- authoritative sim-tick ms (G9 — never wall-clock)
  actor       jsonb       not null,                      -- { accountId, characterId, role } (flat, from GameEvent)
  data        jsonb       not null,                      -- event payload
  recorded_at timestamptz not null default now(),        -- storage wall-time, DB-set OUTSIDE the reducer; NOT hashed
  primary key (stream, seq),                             -- append-ordering + double-append backstop (fail-loud)
  unique (hash)                                          -- catches identical-content forgery / replay
);

-- INSERT + SELECT only — deliberately NO update/delete, so append-only (G4) is enforced at the permission
-- layer. polaris_app gets nothing here (one-writer-per-table: the world owns the log).
grant select, insert on log.event to atlas_app;
