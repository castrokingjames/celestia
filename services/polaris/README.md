# @celestia/polaris

**Polaris** — the HTTP + session tier (**NestJS**). Everything that is *not* the live 20 Hz simulation lives
here: identity and the durable, out-of-band state around it. The realtime server (`services/atlas`) owns the
running world. Built on the shared **`@celestia/firmament`** Nest package (Config / Database / Ticket); every
dependency is resolved through Nest DI.

## Responsibilities

- **Auth (REST handoff)** — login == registration behind the `AuthMethod` port (basic now; Discord/… later);
  issues `{ refreshToken, sessionTicket }` — **no reusable access token** (session-first, `docs/AUTH.md` P1.5).
- **The bound session (WS gateway)** — one live session per account (`@WebSocketGateway`): `session.state`,
  `character.create`, `play.enter`. The connection is the auth surface a stateless API can't be.
- **Accounts + characters** — the durable `account` principal + `auth_identity` satellites; `game_character`
  (per-account save) + `character_placement`.
- **Matchmaking / play** — `play.enter` resolves the zone and mints the one-time **zone ticket** for Atlas.
- **Entitlement / gating** — account `status`. **`GET /health`** — liveness.
- Economy-at-rest, social, moderation/admin, presence — later tiers.

## Boundary (what Polaris is NOT)

- **No live sim, no entity state, no StateView, no tick.** That is Atlas's job.
- Shares **Postgres** + the `@celestia/*` packages with Atlas; they talk out-of-band (the one-time zone-ticket
  hand-off now; ban/revoke pub-sub via Valkey later — not needed single-process).

## Build-once seam

Identity never needs rework: a stable internal `account_id`, login methods as satellites
(`auth_identity(method, external_id) -> account_id`, many-to-one). New login methods = new adapters behind the
`AuthMethod` port, never a schema migration. See `migrations/0001_identity.sql`.

## Layout (NestJS)

```
migrations/              forward-only .sql (0001 identity · 0002 game_character/character_placement)
scripts/                 gen-dev-keys (dev Ed25519 keypair) · grant (role-admin CLI, G11) · ws-smoke (gateway e2e)
src/
  main.ts                bootstrap: Nest app + ws adapter; HTTP + WS on one port
  app.module.ts          root module — imports Config/Database from @celestia/firmament + feature modules
  health.controller.ts   GET /health
  auth/                  AuthController (/auth/:method|refresh|logout) · SessionService · AuthMethod adapters
  accounts/              AccountStore + AccountsService (find-or-create) · grant (role admin)
  characters/            CharacterStore + CharactersService (cap from config)
  session/               the @WebSocketGateway — the bound session (session.state/character.create/play.enter)
  db/migrate.ts          forward-only migration runner
```

Config, the Kysely client + schema, and the EdDSA **Ticket** sign/verify live in **`@celestia/firmament`** (shared
across Polaris + Atlas). Platform's `/nest` entry is compiled (`dist`); services run on `tsx`.

## Status

**P1.5 — session-first auth live on NestJS.** Done ✅: NestJS migration (DI everywhere) · shared
`@celestia/firmament` · identity + elements-roles · `basic` method · find-or-create · session-first sessions
(one-time **session ticket** + rotating refresh, reuse detection, ban-on-refresh — **no access token**) ·
`POST /auth/:method|refresh|logout` + `GET /health` · the WS **session gateway** (one session/account,
`character.create`, `play.enter`) · **zone-ticket** hand-off (verified in Atlas `onAuth`) · characters +
placement persistence · `grant` CLI. Next: Discord/wallet methods · multi-zone · social.
