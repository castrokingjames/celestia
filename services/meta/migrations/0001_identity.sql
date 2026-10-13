-- 0001_identity.sql — Celestia auth identity model.
--
-- THE one schema that must be right up front (ruinous to retrofit): a stable internal
-- account_id, with login methods as satellites. MANY auth_identity rows -> ONE account.
-- Adding Discord/Google/Apple/Steam/wallet later = new auth_identity rows + a new
-- AuthMethod adapter. It is NEVER a schema rework. See services/meta/README.md + docs/AUTH.md.
--
-- Postgres 17: gen_random_uuid() is built in (no pgcrypto needed).

-- role: the user-tier vocabulary (the "elements" scheme — deliberately NOT celestial, so a
-- role can never be mistaken for a subsystem codename). Seeded here so reserving a future role
-- is a ROW, not a migration: active=false means reserved/not-yet-grantable; promote by flipping
-- the flag. Roles are a FLAT vocabulary, not a power ladder — can() resolves capabilities per role.
create table role (
  id          text primary key,
  element     text not null,
  active      boolean not null default true,   -- false = reserved (exists, not yet grantable)
  description text not null,
  created_at  timestamptz not null default now()
);

insert into role (id, element, active, description) values
  ('terra',     'earth',       true,  'regular player (default)'),
  ('aqua',      'water',       true,  'tester'),
  ('aer',       'air',         true,  'staff'),
  ('ignis',     'fire',        true,  'admin / root'),
  -- reserved — meaning fixed now; grant by flipping active to true (no migration):
  ('lux',       'light',       false, 'owner / founder (super-admin, above ignis)'),
  ('fulmen',    'thunderbolt', false, 'moderator / GM (sanction & enforcement)'),
  ('magma',     'molten core', false, 'developer / engineering (deep internal access)'),
  ('ventus',    'wind',        false, 'support / community (swift responders)'),
  ('scintilla', 'spark',       false, 'trial / applicant (pre-tester probation)'),
  ('vapor',     'mist',        false, 'guest / time-boxed trial (ephemeral)');

-- account: the durable principal. Login-agnostic. Everything in the game keys off account.id.
--   role   = user tier (-> role.id); regular logins land as 'terra', privileged login stamps higher.
--            FK guarantees the role EXISTS; grant logic must also check role.active (app-level).
--   status = GATING (can you log in at all), distinct from role/authz (what you may do). Guardrail #6.
create table account (
  id          uuid primary key default gen_random_uuid(),
  handle      text unique,
  role        text not null default 'terra' references role(id),
  status      text not null default 'active' check (status in ('active', 'suspended', 'banned')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index account_role_idx on account (role);

-- auth_identity: one row per (method, external_id). The satellite table that makes auth build-once.
--   method      = which AuthMethod produced it ('basic' now; 'discord','google','steam','wallet' later)
--   external_id = the STABLE id from that method (dev: the username; discord: the snowflake; wallet: the address)
--   secret_hash = only for methods that store a secret here (none in prod; dev gates via env, not here)
-- The unique(method, external_id) is the invariant: a given external identity maps to exactly one account.
create table auth_identity (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references account(id) on delete cascade,
  method      text not null,
  external_id text not null,
  secret_hash text,
  created_at  timestamptz not null default now(),
  unique (method, external_id)
);
create index auth_identity_account_idx on auth_identity (account_id);

-- refresh_token: opaque, rotating, hashed at rest (hash = pepper + raw; the raw is NEVER stored).
-- Access tokens are stateless EdDSA JWTs (not stored). Refresh is the stateful, revocable half.
--   rotated_to = the token this one was exchanged for (rotation chain; reuse of a rotated token = theft -> revoke chain)
--   revoked_at = non-null means dead (logout, ban, or reuse detected)
create table refresh_token (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references account(id) on delete cascade,
  token_hash  text not null unique,
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  rotated_to  uuid references refresh_token(id),
  revoked_at  timestamptz
);
create index refresh_token_account_idx on refresh_token (account_id);
