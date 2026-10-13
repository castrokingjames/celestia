# @celestia/polaris

The **meta** service: the HTTP, persistent, global, cross-zone tier. Everything that is *not*
the live 20 Hz simulation lives here. The realtime server (`services/atlas`) owns the running
world; meta owns identity and the durable, out-of-band state around it.

## Responsibilities

- **Auth** — login/registration (login *is* registration), the `AuthMethod` port + adapters
  (basic now; Discord/Google/Steam/wallet later), session issuance (EdDSA JWT access + opaque
  rotating refresh), and the one-time **connect-ticket** that hands a player off to realtime.
- **Accounts** — the durable `account` principal (stable `account_id`) + `auth_identity` satellites.
- **Entitlement / gating** — account `status` (active/suspended/banned). Distinct from authz
  `can()`, which the realtime TCB enforces on intents.
- **Matchmaking / play** — resolve which zone/channel a player joins; mint the connect-ticket.
- **Economy-at-rest views, social, moderation/admin, presence serving** — later tiers.
- **`GET /health`** — liveness.

## Boundary (what meta is NOT)

- **No live sim, no entity state, no StateView.** That is realtime's job. Meta never ticks.
- Shares **Postgres** and the `@celestia/*` packages with realtime; they communicate out-of-band
  (connect-ticket hand-off now; ban/revoke pub-sub via Valkey later — not needed single-process).

## Build-once seam

Identity is designed to never need rework: a stable internal `account_id`, with login methods as
satellites (`auth_identity(method, external_id) -> account_id`, many-to-one). New login methods are
new adapters behind the `AuthMethod` port — never a schema migration. See `migrations/0001_identity.sql`.

## Layout

```
migrations/              plain .sql, forward-only (0001_identity.sql = role/account/auth_identity/refresh_token)
scripts/gen-dev-keys.ts  generate a dev Ed25519 keypair (base64 PEM) into .env
scripts/grant.ts         server-local admin CLI: set an account's role (bootstrap first `ignis`) — DB-direct, G11
src/
  index.ts               COMPOSITION ROOT — names concrete adapters, wires them, listens (G7)
  app.ts                 Fastify routes: GET /health · POST /auth/:method · /auth/refresh · /auth/logout · /auth/ticket
  config.ts              zod-validated config (config/default.json + env secrets)
  db/                    Kysely schema types · pooled client · forward-only migration runner
  accounts/              AccountStore + findOrCreateAccount (login==registration) + grantRole (role admin)
  auth/
    auth-method.port.ts  the AuthMethod port + VerifiedIdentity (the seam)
    methods/basic.auth-method.ts   basic login adapter (username + BASIC_AUTH_SECRET)
    session.service.ts   EdDSA JWT access + opaque rotating refresh + connect-ticket (+ RefreshStore)
```

## Status

**P1 — auth live over HTTP (Fastify), deployed.** Done ✅: identity schema + elements-roles · `AuthMethod`
port + `basic` method · find-or-create (login==registration) · sessions (EdDSA access + opaque rotating
refresh, reuse detection, ban-on-refresh) · `POST /auth/basic|refresh|logout|ticket` · `GET /health` ·
connect-ticket hand-off (verified in Atlas `onAuth`) · `grant` CLI (bootstrap first `ignis`, G11). Next:
Discord/wallet methods · matchmaking · social. Stack: Fastify · Kysely + `pg` · `jose` (EdDSA).
