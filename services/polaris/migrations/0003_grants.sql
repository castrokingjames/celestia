-- 0003_grants.sql — per-service DB roles enforcing WRITE-OWNERSHIP (docs/PIPELINE.md §3, docs/REFACTOR.md
-- S1 move 6). Polaris (the help desk) owns identity/auth; Atlas (the world) owns game data. Each service
-- connects as its OWN restricted role; the ENFORCED invariant is that Atlas has NO WRITE on account/auth
-- tables — a bug in, or a compromise of, Atlas can neither mint roles, forge identities, nor revoke tokens.
-- Migrations run as the OWNER (admin DATABASE_URL); the apps run as these roles.
--
-- No secrets here (G8): roles are created LOGIN with NO password. The runner (db/migrate.ts) sets dev
-- passwords from env (POLARIS_DB_PASSWORD / ATLAS_DB_PASSWORD) AFTER applying this file; prod sets them via a
-- secrets manager. Idempotent: guarded role creation + grants are safe to re-run.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'polaris_app') then
    create role polaris_app login;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'atlas_app') then
    create role atlas_app login;
  end if;
end $$;

-- Both roles may enter the DB + see the public schema; neither gets any table rights by default (tables are
-- owner-private until granted, and PUBLIC holds no table privileges), so the grants below are the whole story.
grant usage on schema public to polaris_app, atlas_app;

-- ── Polaris: full RW on identity/auth; read-only on the role vocabulary. NOTHING on game data. ──
grant select, insert, update, delete on account, auth_identity, refresh_token to polaris_app;
grant select on role to polaris_app;

-- ── Atlas: full RW on game data. SELECT on account ONLY (FK parent + non-secret identity); NO WRITE on any
--    auth table, and NO access at all to auth_identity / refresh_token / role (secret-bearing / auth-internal). ──
grant select, insert, update, delete on game_character, character_placement to atlas_app;
grant select on account to atlas_app;

-- Future game tables (log.event, world state) default-deny: grant atlas_app explicitly when they land.
