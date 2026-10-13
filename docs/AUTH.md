<!-- Generated 2026-10-06 by a multi-agent design pass: 4 auth facets -> adversarial red-team -> synthesis. -->
<!-- Authority for Celestia authentication. Supersedes Seam 1 of ARCHITECTURE.md for all auth-provider specifics. -->

# Celestia Authentication Specification

**Status:** **The "As built (P1)" section below is authoritative for what currently exists.** §0–§8 are the original forward design (Discord/Telegram/alpha-gated, NestJS + Passport + Redis) — **largely NOT yet implemented**; treat them as the aspirational target, not current state. **Where the two conflict, As built wins.**
**Owners:** Platform / Auth.
**Scope (design target):** Discord-authenticated sessions for the Godot client across Web/Desktop/Mobile/Telegram; a meta service as account authority + token issuer; the realtime server as offline-verifying resource server. **What's built today is a small subset — see As built (P1).**

> This document opens with a **Canonical Constants** block. Section-level drift (channel names, claim shapes, subject ids, signing algorithms) was the top-ranked risk in red-team; those values are frozen here and MUST be imported from a single shared package (`@celestia/auth-contract`), never re-declared per service. A contract test (§7, MUST-13) fails CI if issuer and verifier disagree.

---

## As built (P1) — authoritative for the current implementation

What actually ships today is a lean subset of the design below: **Polaris** (`services/polaris`, `@celestia/polaris`) — a **Fastify** HTTP service on **Kysely + node-postgres** and **`jose`** (EdDSA) — plus connect-ticket verification in **Atlas** (`services/atlas`, Colyseus). **No Discord, Telegram, NestJS, Passport, or Redis/Valkey yet** — those stay forward design.

**Auth method (port + adapters).** `AuthMethod` is an **authentication-only** port (authn, not authz). The one implemented adapter is **`basic`**: `{ username, secret }`, where `secret` is a shared **`BASIC_AUTH_SECRET`** that only gates *access to the method* — it grants **no role**. Discord/Google/Apple/Steam/wallet are future sibling adapters behind the same port (no core change). The username is the stable external id.

**Identity — login *is* registration** (`migrations/0001_identity.sql`):
- `account` — stable internal `account_id` (uuid); `handle` (chosen later, nullable); `role` (→ `role` table, default `terra`); `status` (`active|suspended|banned`).
- `auth_identity(method, external_id)` **UNIQUE → `account_id`**, many-to-one — the satellite table that makes adding methods *and* account-linking a non-migration.
- `refresh_token` — opaque, rotating, **hashed at rest**.
- `role` — the seeded **elements** vocabulary (below).

`findOrCreateAccount`: first sight of a `(method, external_id)` creates the account at role `terra`; the response carries `{ session, account, created }`.

**Sessions** (`SessionService`, `jose`):
- **Access** = EdDSA **JWT**; claims `sub` = `account_id` + `role` (role read from authoritative DB — **G11**, never a client input). TTL 900 s.
- **Refresh** = opaque random token, **rotating**; only a pepper-HMAC (`AUTH_TOKEN_PEPPER`) is stored, never the raw. Rotation chain; **reuse of a spent token burns the account's whole chain**; refresh re-reads role from the DB and **refuses if `account.status != 'active'`** (ban-takes-effect-on-refresh). TTL 30 d.

**HTTP endpoints** (Fastify, `src/app.ts`):

| route | does |
|---|---|
| `POST /auth/:method` | login == registration for an enabled method (`basic` now) → `{ session, account, created }`, always role `terra` |
| `POST /auth/refresh` | rotate refresh → new session; replay / expired / inactive → 401 |
| `POST /auth/logout` | revoke the presented refresh (idempotent) → 204 |
| `POST /auth/ticket` | `Bearer <access>` → a one-time **connect-ticket** for the realtime server |
| `GET /health` | liveness |

CORS via `config.corsOrigins`; enabled methods via `config.auth.enabledMethods` (`["basic"]`).

**Connect-ticket (meta → realtime handoff).** `POST /auth/ticket` (bearer access; re-reads the authoritative account) issues a short-TTL EdDSA JWT (`config.auth.connectTicketTtlSec`, 30 s) with `aud: "realtime"` + a `jti`. **Atlas** verifies it in `onAuth` (same public key, `aud` + one-time `jti` dedupe) and rejects any join without a valid ticket (`services/atlas/src/auth/ticket.ts`). *(No Redis `GETDEL`; the ticket is a self-verifying signed JWT with an in-process jti guard — single-process for now.)*

**Roles = the "elements" vocabulary** (`docs/NAMING.md`), seeded in the `role` table, stored on `account.role`:
- **active:** `terra` (default player) · `aqua` (tester) · `aer` (staff) · `ignis` (admin/root).
- **reserved** (seeded `active=false`): `lux` · `fulmen` · `magma` · `ventus` · `scintilla` · `vapor`.

**G11 — client never sets its own privilege.** Every login lands at `terra`; role is server-only state a request can never ask for. Elevation only via an audited admin action by an already-privileged principal, or the **server-local `grant` CLI** (`pnpm --filter @celestia/polaris grant <handle|accountId> <role>`) — DB-direct, requiring shell/DB access, **no network path, no shareable secret**. Authz reads authority from `account.role`, never a client-asserted claim.

**Secrets/env.** `BASIC_AUTH_SECRET` (gate) · `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` (base64-encoded PEM; `gen-dev-keys`) · `AUTH_TOKEN_PEPPER`. (**Not** `CELESTIA_DEV_AUTH_SECRET`.)

### Divergence from the forward design (§0–§8)

| Design (below) | As built |
|---|---|
| `provider` / `idp_provider` enum | `AuthMethod` + `auth_identity.method` (text) |
| `dev` method / `DevAuthMethod` / `CELESTIA_DEV_AUTH_SECRET` | the **`basic`** method / **`BASIC_AUTH_SECRET`** |
| Passport (`passport-discord`, `passport-jwt`) | none — our `AuthMethod` adapters + `jose` only |
| NestJS (Fastify adapter) | plain **Fastify** |
| dbmate · ioredis/Valkey · Redis revocation overlay | custom SQL migrate runner · **no Redis yet** (connect-ticket = self-verifying JWT, not Redis `GETDEL`) |
| Discord OAuth / PKCE / Telegram Mini App / handoff codes | **not built** — `basic` only (future adapters behind the port) |
| Alpha guild-role gate · `ent:["alpha"]` · live revocation bus | **not built** — roles = elements vocab; `account.status` gates login; no live-revoke bus yet |
| `external_identities` / `refresh_token_families` / `entitlements` | `auth_identity` / `refresh_token` / `role` (simpler) |
| `MagicLinkMethod` + `tester_allowlist` | **not built** (future / optional) |
| Access TTL 600 s | **900 s** |

---

> **§0 onward is the original forward/aspirational design** (Discord · Telegram · NestJS · Passport · Redis · alpha-gate) — **largely NOT yet implemented**. It's the target posture, not current state; where it conflicts with *As built (P1)* above, **As built wins**. Promote pieces into "As built" as they actually ship.

---

## 0. Canonical Constants (frozen — single source of truth)

| Name | Value | Notes |
|---|---|---|
| Auth authority / `iss` | `https://api.celestia.gg` | NestJS |
| Web SPA origin | `https://play.celestia.gg` | same eTLD+1 as api |
| JWKS | `https://api.celestia.gg/.well-known/jwks.json` | |
| Telegram bot / app | `@celestia_bot` / `game` | deep link `https://t.me/celestia_bot/game?startapp=<code>` |
| Alpha guild / role | `ALPHA_GUILD_ID` / `ALPHA_ROLE_ID` | gate by **role ID**, never name |
| **Signing algorithm** | **EdDSA (Ed25519)**, `kid`-tagged | pinned EVERYWHERE; symmetric algs never in any accept list |
| **JWT `sub`** | **`account_id`** (Celestia UUID) | the ONLY canonical subject; all revocation keys derive from it |
| **Entitlement claim** | **`ent: ["alpha"]`** (string array) | checked via shared helper `hasEntitlement(claims,"alpha")` |
| Access TTL | **600 s (10 min)** | clock skew tolerance ±60 s on `nbf`/`exp` |
| Refresh TTL | 30 d sliding / 90 d absolute | opaque, rotating, reuse-detected |
| Handoff code TTL | **60 s**, single-use (`GETDEL`) | |
| OAuth txn TTL | **300 s**, single-use | |
| Connect-ticket TTL | **30 s**, single-use (`GETDEL`) | Colyseus proof-of-possession |
| **Revocation pub/sub channel** | **`celestia:auth:revoke`** | one constant, imported by NestJS + Colyseus |
| Discord scopes | `identify guilds.members.read` | `email` optional; `guilds.members.read` is the bot-down fallback only |

**Redis key namespace (frozen):**
```
oauth:txn:<state>              EX300  single-use      {host,idp,server_verifier,redirect_uri?,tg_user_id?,device_secret_h?,init_nonce,created}
handoff:<code>                 EX60   GETDEL          {account_id,sid,tg_user_id?,device_secret_h?,init_nonce,host}
rt:fam:<family_id>             EX30d  HASH            rotation+reuse state (also mirrored in Postgres)
revoked:jti:<jti>              EX=access-ttl                       instant access-token kill
revoked:sid:<sid>              EX=refresh-ttl                      session (family) kill
uversion:<account_id>          persistent  INT        == accounts.token_version; GLOBAL kill lever
ban:<account_id>               EX=refresh-ttl
gate:<account_id>              EX300  {allowed,roles,checked_at,method}
guild:<GID>:role:<RID>:members SET (gateway-maintained)           O(1) SISMEMBER cache
connect:<ticket>               EX30   GETDEL          {account_id,sid,jti}
initdata:seen:<sha256>         EX300                               initData replay cache
fail:ip:<ip> / fail:dev:<h> / fail:tg:<id>   EX900                 sliding-window lockout
```

---

## 1. Overview + Trust Model

Celestia authenticates **every** user on **every** host — Web, Desktop, Mobile, and inside the Telegram Mini App — with **Discord OAuth 2.0 Authorization-Code + PKCE**. Discord is the sole identity authority; the confidential code→token exchange always runs in NestJS. **Telegram `initData` is never identity** — it is validated only to prove a request rode the Mini App channel, and `tg_user_id` is used solely as an anti-portability *binding attribute* on the handoff. After Discord establishes identity, NestJS **gates on Discord guild membership + the `ALPHA_ROLE_ID` role before minting anything**, then issues Celestia's own session: a short-lived **EdDSA access JWT** (10 min) plus an **opaque, rotating refresh token**. **Colyseus trusts only the Celestia JWT** — it verifies the signature offline via cached JWKS and consults Redis for the live-revocation overlay, never calling NestJS per-connect. Alpha access is a *live* privilege: a Discord gateway bot pushes role/membership loss into Redis, which (a) bumps the global `uversion` kill lever, (b) revokes the refresh family, and (c) kicks the live Colyseus socket on `celestia:auth:revoke` — so losing the role evicts a connected player within seconds and caps any residual at the 10-min access TTL. Design stance throughout: **assume the `t.me` link is public, assume one XSS in the WebView, assume a stolen refresh token — and still deny the attacker a session.**

---

## 1A. Auth Tech Stack (addendum — 2026-10-11)

> ⚠️ **PLANNED stack — not as-built.** This section is the *aspirational* auth runtime (NestJS · Passport · Redis/Valkey · dbmate). What actually ships is leaner — **Fastify · `jose` · Kysely + node-postgres · no Passport · no Redis** — see **As built (P1)** at the top (As built wins on conflict). Kept here as the target posture.

*Terminology: **"issue"** = create + sign a session token (auth); **"mint"** is reserved for web3 (on-chain assets).*

### Platform & runtime
| Layer | Pick | Role |
|---|---|---|
| Runtime | **Node.js 22 LTS** | runs NestJS **and** Colyseus |
| Language | **TypeScript 5.7** | — |
| Monorepo | **pnpm + Turborepo** | shared `@celestia/*` packages (incl. `@celestia/auth-contract`) |
| Edge | **Caddy** | reverse proxy + auto-TLS (Let's Encrypt); routes `/auth/*`→NestJS, `wss`→Colyseus |

### Frameworks
| Framework | Pick | Role in auth |
|---|---|---|
| Meta/API | **NestJS** (Fastify adapter) | the auth authority — OAuth exchange, token **issue**, accounts, gate; Guards enforce routes |
| Realtime | **Colyseus 0.16** | verifies the JWT **offline** in `onAuth`; never issues tokens |

### Auth libraries
| Concern | Library | Notes |
|---|---|---|
| OAuth login + Guards | `passport` + `@nestjs/passport` + `passport-discord` | the identity-provider dance; idiomatic NestJS. *Manual OAuth is a leaner alt, hidden behind the `AuthMethod` port.* |
| JWT issue + verify | **`jose`** | EdDSA/Ed25519 sign (NestJS) + JWKS verify (Colyseus `onAuth` and the NestJS JWT guard) |
| JWT route guard (NestJS) | `passport-jwt` *or* a thin `jose` guard | validates the access JWT on REST routes |
| Validation | `zod` (+ `nestjs-zod`) | request/response schemas |
| Valkey client | `ioredis` | connect-tickets, revocation overlay, handoff codes, rate-limit |
| DB | **Kysely** (read) + **dbmate** (migrations) | `accounts` / `external_identities` / `refresh_*` / `entitlements` (§6) |
| Crypto primitives | `node:crypto` | PKCE verifier/challenge, opaque tokens, Telegram `initData` HMAC |
| Rate limiting | `rate-limiter-flexible` (or Valkey sliding window) | per-IP / per-identity on `/auth/*` (MUST-11) |

### Deferred auth libs (not v1)
| Library | For | When |
|---|---|---|
| `discord.js` | gateway bot → live role-revocation push | when instant kick matters (login gate uses a plain REST `fetch` meanwhile) |
| `argon2` (argon2id) | username+password hashing | if/when the password `AuthMethod` ships |
| email SDK (Resend / Postmark / SES) | magic-link tester login (§2A.3) | if used |

### Token types (not everything is a JWT)
| Token | Type | TTL | Store |
|---|---|---|---|
| **Access** | EdDSA **JWT** | 10 min | — (verified offline via JWKS) |
| **Refresh** | **opaque**, hashed, rotating + reuse-detected | 30d sliding / 90d abs | Postgres + Valkey mirror |
| **Connect-ticket** | opaque, single-use | 30s | Valkey `connect:<ticket>` |
| **Handoff code** (Telegram) | opaque, single-use | 60s | Valkey `handoff:<code>` |
| **Staff token** | separate EdDSA JWT (`aud:celestia-admin`, `amr:mfa`) | ~15 min | step-up only (see AUTHZ.md §4.2) |

### Protocols & standards
- **OAuth 2.0 Authorization Code + PKCE** (RFC 7636); **RFC 8252** (loopback / App-Link) for native.
- **JWT** (RFC 7519), **EdDSA/Ed25519** (RFC 8037), **JWKS** (RFC 7517) — HS256/symmetric algs banned on every verifier.
- **Opaque rotating refresh** (rotation + reuse detection).
- **Telegram Mini App `initData`** HMAC/Ed25519 — channel proof only, never identity.

### Passport vs `jose` — complementary, both in the stack
- **Passport** (`passport-discord`) = **logging you in** via Discord (the OAuth dance) → a verified identity.
- **`jose`** = **our own session token** — issue the EdDSA JWT after login, verify it on every request/connect.
- *Passport gets you in the door; `jose` issues and checks your session key.*

### Client side (auth-relevant)
- **Godot 4.5 (GDScript)** opens the OAuth flow (in-app browser / WebView / redirect), stores tokens (httpOnly cookie on web; OS secure storage on native), and connects to Colyseus with the JWT via **auth options (never the URL)**.

### Deliberately NOT using (v1)
- **No managed auth provider** (Auth0/Clerk/Cognito) — we own auth; NestJS issues our JWT. *(A managed IdP could slot in later as an `AuthMethod`.)*
- **No HS256 / symmetric JWT** — EdDSA only, pinned.
- **No classic server-session store + cookie** — stateless JWT + opaque refresh.
- **No storing Discord/upstream tokens at rest** — discarded after `/users/@me`.

---

## 2. Master Login Sequence — Telegram Mini App

The Mini App runs Godot in an in-app WebView that **cannot** complete a Discord redirect (Discord blocks embedded WebViews and the WebView can't be redirected back). OAuth therefore runs in the **external system browser (EB)**; the result crosses back via `startapp=<handoff_code>`. The PKCE verifier stays **server-side** (Pattern B); the crossing carries only an opaque, non-portable lookup key — **never a JWT**.

```
MiniApp WebView (MA)            NestJS (api.celestia.gg)         System Browser (EB)        Discord
  Telegram.WebApp.ready()
  dev_secret = secureGet() | gen 256-bit CSPRNG (first run)
  |-- POST /auth/discord/start -------->|
  |   {host:"telegram", initData,       |  validate initData (Ed25519 sig; see §5.MUST),
  |    device_secret}                   |  freshness<=300s, replay-cache check
  |                                     |  tg_user_id := initData.user.id  (CHANNEL attr, NOT identity)
  |                                     |  mint state + SERVER PKCE verifier/challenge(S256) + init_nonce
  |                                     |  Redis oauth:txn:<state> EX300 {tg_user_id,device_secret_h,server_verifier,init_nonce,idp:"discord"}
  |<-- {authorize_url, state} ----------|
  |  Telegram.WebApp.openLink(authorize_url)  ---> opens EXTERNAL browser --->|
  |                                     |                                     |-- GET discord.com/oauth2/authorize
  |                                     |                                     |   ?response_type=code&client_id&scope=identify guilds.members.read
  |                                     |                                     |   &redirect_uri=api.celestia.gg/auth/discord/callback
  |                                     |                                     |   &state&code_challenge&code_challenge_method=S256 -->|
  |                                     |                                     |<-- user consents (SSO) --------------------------------|
  |                                     |<-- 302 /auth/discord/callback?code&state (to NestJS, in EB) --|
  |                                     |  GETDEL oauth:txn:<state> (single-use); verify iss
  |                                     |  POST discord/oauth2/token (client_secret + server_verifier) -> user token
  |                                     |  GET /users/@me (identity) ; then REVOKE user token (not stored)
  |                                     |  GATE: Bot GET /guilds/<GID>/members/<discord_id> -> require ALPHA_ROLE_ID
  |                                     |     deny -> render EB error page "open Telegram" (NO mint, 403)
  |                                     |  upsert account+identity+entitlement (find-or-create, ON CONFLICT)
  |                                     |  create family(sid); handoff:<code> EX60 {account_id,sid,tg_user_id,device_secret_h,init_nonce}
  |                                     |-- 302 https://t.me/celestia_bot/game?startapp=<code> --> OS hands t.me to Telegram
  |  (Telegram relaunches MA; initDataUnsafe.start_param === <code>; initData freshly re-signed)
  |-- POST /auth/exchange ------------->|  GETDEL handoff:<code> (single-use)
  |   {handoff_code, initData,          |  re-validate initData (fresh) + replay cache
  |    device_secret}                   |  REQUIRE: tg_user_id match && device_secret_h match && init_nonce match
  |                                     |  (any mismatch -> burn code + revoke family + generic 401 + fail-counter)
  |                                     |  mint access JWT + refresh token (NEW family already created at callback)
  |<-- 200 {access_token, refresh_token, expires_in, user} --|   (JWTs ONLY here, over HTTPS, never in a URL)
  |  store access in MEMORY; refresh via httpOnly cookie on api.celestia.gg (or memory-only, see §7.MUST-6)
  |-- POST /auth/connect-ticket (Bearer access) -> {ticket} ; connect Colyseus w/ {token, ticket} in auth options
```

### How other hosts differ (one mechanism, three return legs)

| Host | PKCE verifier | Discord `redirect_uri` | Return leg | Token storage |
|---|---|---|---|---|
| **Web** (Godot HTML5) | **Server** (Pattern B) | `api.celestia.gg/auth/discord/callback` | httpOnly `celestia_rt` cookie + `GET /auth/session` for access | refresh = httpOnly `SameSite=Strict` cookie; access = memory |
| **Desktop** | **Client** (Pattern A) | `http://127.0.0.1:51789/cb` (+ fallback ports) loopback | client proxies `{code,code_verifier,state}` to `POST /auth/discord/callback` → **JWTs in body** | OS secure store (Keychain/Cred Mgr/libsecret); access = memory |
| **Mobile** | **Client** (Pattern A) | **verified App Link** `https://app.celestia.gg/auth/cb` (preferred) / Universal Link; `ASWebAuthenticationSession` on iOS | same as desktop → **JWTs in body** | OS secure store |
| **Telegram** | **Server** (Pattern B) | `api.celestia.gg/auth/discord/callback` | one-time handoff code via `startapp=` → `POST /auth/exchange` | see §2 above |

- **Pattern A (native):** Discord redirects the `code` onto the device (loopback or verified App Link — never a bare custom scheme as default; custom schemes are hijackable); the client holds the verifier; the client POSTs `{code,code_verifier,state}` and gets **JWTs in the response body**. A hijacked/sniffed `code` is useless (no `client_secret`, no verifier) and **no JWT ever traverses a URL**.
- **Pattern B (web/telegram):** verifier never leaves NestJS; the Discord `code` never touches the client. Session returns via cookie (web) or one-time handoff code (telegram).
- Native hardening (move native to Pattern B too) is an **open decision (§8)**; Pattern A is specified as primary to honor the locked "public clients use PKCE + state" wording.

---

## 2A. Auth methods, portal launch & tester access (addendum — 2026-10-09)

*Added after §0–§2 were frozen. Generalizes the Discord-only framing to a swappable **`AuthMethod` port**, names the **portal-login→launch** flow (of which §2's Telegram sequence is one instance), and specifies a **non-Discord tester path**. Nothing here changes the frozen constants (§0), the session/token model (§4), the gate (§5), or `onAuth` (§6) — every method converges on the same `account_id` → gate → mint → ticket machinery.*

### 2A.1 The `AuthMethod` port — authentication (AuthN) vs authorization (AuthZ)

§1's "Discord authenticates every user" is the **production, real-user** posture and still holds. Underneath, authentication is a **port** so added methods are additive, never a rewrite:

```ts
// @celestia/auth-contract
interface Identity {                       // what ANY method produces once it has verified the user
  provider: 'discord' | 'dev' | 'email';   // idp_provider enum (§6); NEVER 'telegram'
  providerUserId: string;                  // stable id within that provider
  email?: string; displayName?: string;
}
interface AuthMethod {                      // one adapter per method; swapped at the composition root
  readonly id: string;                      // 'discord' | 'dev' | 'email'
  verify(input): Promise<Identity>;         // OAuth exchange / dev-grant / magic-link → verified Identity, else throw
}
```

- **AuthN (the method)** proves *who you are* and emits an `Identity`. Adapters: `DiscordOAuthMethod` (today; wraps the §2/§3 flows), `DevAuthMethod` + `MagicLinkMethod` (2A.3). Passport strategies / OAuth libs live **inside** adapters — implementation detail, never the architecture.
- **AuthZ (who's allowed)** is separate and method-independent: the §5 gate + the `ent:["alpha"]` entitlement. Whether alpha is *sourced* from a Discord role (prod) or a tester allowlist (2A.3) does **not** change `hasEntitlement()` or `onAuth`.
- After `verify()` → `Identity`, the path is **identical for every method**: find-or-create `account_id` → authorize (gate/entitlement) → mint access JWT + refresh (§4) → `connect-ticket` (§3). `AuthService` never branches on which method produced the identity.

### 2A.2 Portal login → launch — one handoff for every target

§2's Telegram sequence is **one instance** of a general pattern: **authenticate in a browser context, then carry the session into the launched game context via a one-time handoff code.** A launcher/portal site (log in once; then "Play") routes to:

| Launch target | Session carry | Code needed? |
|---|---|---|
| **Web, same-origin** (`play.celestia.gg`) | httpOnly `celestia_rt` cookie already present (§3 `GET /auth/session`) | **No** |
| **Telegram Mini App** | `startapp=<handoff_code>` → `POST /auth/exchange` (§2) | **Yes** — bound to tg_user_id + device_secret + init_nonce |
| **Android wrapper (TWA)** | TWA **shares the Chrome cookie jar** → the web session carries in automatically | usually **No** |
| **Android wrapper (plain WebView)** | isolated cookies → one-time code via `celestia://` App Link → `POST /auth/exchange` | **Yes** — bound to device_secret + init_nonce (no tg_user_id) |

- The code is **always the §4.1 handoff code** (opaque, 60 s, single-use `GETDEL`, bound); JWTs return **only** in the `/auth/exchange` body, never in a URL. This is the §2 mechanism reused — no new primitive.
- **Android is the TWA/WebView wrapper around the web export** (per TECH-STACK/SDK — there is no native Godot client); "deep-link to native" means opening the wrapper on the web URL, and a TWA may need no code at all.
- **⟐ Decision (→ §8.13): uniform code vs skip-for-web.** Recommended: run the handoff code for *every* launch (even same-origin web) so there is one testable auth path and no special-case; cost is a redundant exchange on web. Alternative: web uses the cookie directly, code only for cross-context. Pick one and freeze it.
- **App-not-installed fallback:** an "Open in app" deep link that doesn't resolve MUST fall back to "Play in browser" (Android App Links do this) — no dead button.

### 2A.3 Dev / tester auth — a non-Discord path for authorized testers

Testers (team) must authenticate **without a Discord account**, on web or the Android wrapper. This is additional `AuthMethod` adapters plus an **authorization allowlist** — never a loosening of the gate. Two adapters, chosen by environment:

| Testers hit | Method adapter | Posture |
|---|---|---|
| **Local dev** (localhost) | `DevAuthMethod` — `POST /auth/dev {username, devSecret}` → `Identity{provider:'dev'}` | **non-prod only**; shared `CELESTIA_DEV_AUTH_SECRET`; env-gated |
| **Shared staging / prod-adjacent** | `MagicLinkMethod` — email magic-link restricted to the team (allowlisted addresses / company domain) | **real auth, no backdoor**; per-user, revocable, auditable |

- **Authorization = a server-side `tester_allowlist`** (identities, revocable). Both tester methods check it before minting; a `TesterEntitlementSource` grants `ent:["alpha"]` to allowlisted testers — so §5/§6 and `onAuth` are **unchanged**, only the entitlement *source* differs (Discord-role in prod ↔ allowlist for testers). "Certain users only" lives in the allowlist (per-user), **never** in a shared secret acting as a backdoor.
- **Hard safety rails (MUST):**
  - `DevAuthMethod` + `DevEntitlementSource` are wired at the composition root **only when `NODE_ENV !== 'production'`**.
  - **Fail-closed boot assertion:** if `NODE_ENV === 'production'` and any dev-auth adapter/route is registered → **crash on startup**. A CI manifest check asserts dev-auth is absent from the prod adapter set (same spirit as MUST-13).
  - `CELESTIA_DEV_AUTH_SECRET` is **required even in dev/staging** (never committed) so a shared box isn't open to anyone who finds the URL.
  - `provider:'dev'` identities are visibly distinct in data → auditable, purgeable, never confusable with real users.
- **Seeded personas** (`alice`/`bob`/`carol`, distinct `account_id`, pre-entitled) let testers exercise per-player relationships & co-presence (two players ↔ one NPC) with one-click logins.
- **Timing:** the **P0 offline sandbox has no auth at all** (dev-stub, §8.8). These tester methods matter from **P1**, when the authed/multiplayer/alpha-gated build exists.

### 2A.4 Reconciliation with the frozen sections

- **§1 unchanged for real users:** Discord remains the sole identity authority in production; dev/magic-link are env-gated / allowlisted additions that converge on the same `account_id`→gate→mint→ticket path.
- **§6 enum:** extend `idp_provider` to `ADD VALUE 'dev'` (non-prod) and `'email'` (magic-link) alongside the planned `'google'`/`'apple'`; **still NEVER `'telegram'`** (channel attribute, not identity).
- **New endpoints** (join §3): `POST /auth/dev` (non-prod only), `POST /auth/magic/start` + `POST /auth/magic/verify` (team). All rate-limited (MUST-11); all mint only after the allowlist/gate passes.
- **New Redis keys** (§0 namespace discipline): `tester:allowlist` (SET of allowed identities), `magic:<token>` (EX600, single-use `GETDEL`).

---

## 3. NestJS Endpoints

All `/auth/*` routes are rate-limited (§7, MUST-11). All reject symmetric JWT algs and pin EdDSA.

### `POST /auth/discord/start` — begin a flow
```jsonc
// req
{ "host": "web|desktop|mobile|telegram",
  "redirect_uri": "http://127.0.0.1:51789/cb",  // native only; MUST be in server allowlist
  "code_challenge": "<base64url>",               // native only (client-held PKCE)
  "state": "<client-random>",                    // native only
  "device_secret": "<256-bit b64url>",           // native + telegram (binding, hashed before store)
  "init_data": "<raw Telegram initData>" }       // telegram only (channel proof)
// res
{ "authorize_url": "https://discord.com/oauth2/authorize?response_type=code&client_id=...&scope=identify%20guilds.members.read&redirect_uri=...&state=<state>&code_challenge=<c>&code_challenge_method=S256",
  "state": "<state>" }
```
- Web/Telegram: NestJS generates verifier+challenge+state server-side, writes `oauth:txn:<state>` (no client verifier), builds URL with its own challenge + HTTPS callback. Telegram validates `init_data` and captures `tg_user_id`.
- Native: NestJS validates `redirect_uri` ∈ allowlist, stores `oauth:txn:<state>` **without** verifier (client holds it), builds URL with the **client's** challenge + redirect_uri. URL construction stays server-side so `client_id`/scope policy is authoritative.

### `GET /auth/discord/callback?code&state` — Pattern B (web/telegram browser redirect)
`GETDEL oauth:txn:<state>` (single-use; CSRF-pinned to initiator) → verify `iss` → confidential token exchange with the **server** verifier → `GET /users/@me` → **immediately revoke the Discord user token** (not stored) → **gate (§5)** → find-or-create account → create family. Then:
- **web:** `Set-Cookie: celestia_rt=<refresh>; HttpOnly; Secure; SameSite=Strict; Domain=api.celestia.gg; Path=/auth` + `302` to `play.celestia.gg`.
- **telegram:** write `handoff:<code>` + `302` to `https://t.me/celestia_bot/game?startapp=<code>`.
- **deny / Discord error:** render HTML page in EB with an "open Telegram / return to app" button; **no mint**; `403`.

### `POST /auth/discord/callback` — Pattern A (native proxy)
```jsonc
// req  { "code":"...", "code_verifier":"...", "state":"...", "redirect_uri":"http://127.0.0.1:51789/cb", "host":"desktop" }
// res 200  { "access_token":"<jwt>", "refresh_token":"rt1_...", "expires_in":600, "token_type":"Bearer",
//           "user":{"id":"<account_id>","discord_id":"...","name":"...","avatar":"..."} }
// res 403  { "error":"not_in_alpha" }
```
`GETDEL oauth:txn:<state>`; verify stored `redirect_uri` matches; confidential exchange with the **client's** `code_verifier`; revoke Discord user token; gate; mint. **JWTs returned in the body only.**

### `POST /auth/exchange` — one-time handoff → JWTs (Telegram)
```jsonc
// req  { "handoff_code":"h1_<43 b64url>", "init_data":"<fresh raw>", "device_secret":"<256-bit>" }
// res 200  { "access_token":"...", "refresh_token":"...", "expires_in":600, "user":{...} }
// res 401  { "error":"handoff_invalid_or_used" }   // generic; no field-level oracle
```
Atomic `GETDEL handoff:<code>` → re-validate `init_data` (+ replay cache) → **REQUIRE `tg_user_id` match AND `device_secret_h` match AND `init_nonce` match** → mint. **No `code_verifier` field exists on this endpoint** (verifier is server-side; see §7, MUST-2). Any mismatch burns the code, revokes the family, increments `fail:*`, returns generic 401.

### `GET /auth/session` — web only
Reads httpOnly `celestia_rt`, returns a fresh access token so Godot-WASM/Colyseus can use it (refresh stays in the cookie). `{ "access_token":"...", "expires_in":600, "user":{...} }`.

### `POST /auth/refresh` — rotate + re-gate
`{ "refresh_token":"rt1_<fam>.<gen>.<secret>" }` (web: via cookie). Validates family, **reuse-detects (§4.3)**, re-checks the gate cache (§5), rotates (new refresh, old generation retired), mints fresh access with current `ver`. `401` with force-re-login on reuse/revocation.

### `POST /auth/connect-ticket` — Colyseus proof-of-possession
`Bearer <access>` → writes `connect:<ticket>` EX30 `{account_id,sid,jti}` → `{ "ticket":"<opaque>", "expires_in":30 }`. Single-use (Colyseus `GETDEL`s it). Keeps the JWT and a replay-neutralizing nonce out of the `wss://` URL.

### `POST /auth/logout` — local; `POST /auth/logout/all` — global
Local: revoke the one family (`revoked:sid`), set `revoked:jti` for the current access, clear cookies → `204`. Global: `INCR uversion:<account_id>` + bump `accounts.token_version`, revoke all families, `PUBLISH celestia:auth:revoke` → `204`. (We hold no Discord token at rest, so there is nothing to revoke upstream; Discord SSO persistence is accepted and documented in §7, MUST-18.)

---

## 4. Handoff Code + JWT + Refresh Rotation

### 4.1 One-time handoff code
- **Generation:** `crypto.randomBytes(32)` → base64url (43 chars, 256-bit) → prefix `h1_` → 46 chars, within `[A-Za-z0-9_-]` and ≤64 (Telegram `start_param` limit).
- **TTL:** 60 s. It only has to survive the EB→Telegram tab switch.
- **Single use:** Redis `GETDEL` (atomic read-and-delete); a replay finds nothing.
- **Binding (ALL required at `/exchange`):** `tg_user_id` (same Telegram channel), `device_secret_h` (same install), `init_nonce` (same initiation). The code is a Redis lookup key resolving to pre-authorized `{account_id, sid}` — **it carries no identity and no token itself**, so interception off the originating device/channel is bearer-useless.
- **Fail-closed:** any mismatch/expiry/second-use → burn + revoke family + generic 401 + `fail:*` increment; timing-safe compares throughout.

### 4.2 Access JWT (EdDSA / Ed25519, `kid`)
```jsonc
{ "iss":"https://api.celestia.gg", "sub":"<account_id>",
  "aud":["celestia-realtime","celestia-api"],
  "iat":1759742400, "nbf":1759742400, "exp":1759743000, "jti":"<uuid>",
  "sid":"<refresh_family_id>",        // session == family; revoke-by-family
  "ver":3,                            // MUST equal uversion:<account_id>; global kill lever
  "ent":["alpha"],                    // canonical entitlement array; hasEntitlement() helper
  "did":"<discord_id>", "idp":"discord", "scope":"play" }
```
Verified offline by Colyseus and the NestJS API guard via JWKS. **`sid` == the refresh family id** — there is no separate `fid`; revocation always targets the family (= the session).

### 4.3 Refresh token (opaque, not a JWT) + rotation
Format `rt1_<family_id>.<generation>.<secret_b64url>`. Only `sha256(secret)` is stored (Postgres `refresh_tokens` + `rt:fam:<family_id>` Redis mirror). One **family per login/device**.

`POST /auth/refresh`:
1. Parse family/gen/secret; load family. `revoked`/missing → 401 + re-login.
2. **`gen == cur_gen`, secret matches** → rotate: `prev := cur`, bump `cur_gen`, new secret, `grace_until = now+10s`; issue new access + refresh.
3. **`gen == prev_gen` within grace** → idempotent re-issue (absorbs mobile double-submit/flaky networks; not a re-rotation).
4. **`gen < cur_gen` OR unknown secret at a known gen → REUSE DETECTED** → revoke the **entire family**, log a security event, 401. Reuse is caught on the *second* presentation regardless of which party used it first.
5. Every refresh re-checks `device_secret`/`did` consistency and re-runs the gate cache (§5); the fresh access carries current `ver`, so a global revoke lands within one refresh.

---

## 5. Guild-Role Gating + Entitlement Lifecycle

**Decision: a Discord gateway + REST BOT is the primary gate; the OAuth `guilds.members.read` scope is the resilience fallback.** Only a bot gateway connection provides push eviction, and the bot checks membership by Discord user-id without a user token — the seam that keeps gating alive under multi-IdP (a future Google login still gates against the linked Discord identity). **The gate always runs server-side, after identity, before any mint, on every host** (Telegram's handoff code is minted downstream of a passed gate).

### Login-time gate (every host, before mint)
`GET /guilds/<ALPHA_GUILD_ID>/members/<discord_id>` with `Bot <token>` → `200 {roles[]}` must contain `ALPHA_ROLE_ID`; `404`/missing role → **deny, no JWT**. Cache `gate:<account_id>` EX300. Gate by **role ID** (rename-safe).

### Live revocation reaching a connected Colyseus client
A gateway bot (`GUILD_MEMBERS` intent, **run as a separate process/secret scope from the auth signer** — see §7, MUST-5) consumes:
- `GUILD_MEMBER_UPDATE` (role dropped), `GUILD_MEMBER_REMOVE` (left/kick/ban), `GUILD_ROLE_DELETE`.

On revocation:
```
SREM guild:<GID>:role:<RID>:members <discord_id> ; DEL gate:<account_id>
map discord_id -> account_id ; set entitlements.revoked_at,reason
INCR uversion:<account_id>  (+ bump accounts.token_version)   # GLOBAL kill — blocks reconnect on still-signed tokens
revoke all families (revoked:sid) + kill refresh in Postgres  # blocks /auth/refresh
PUBLISH celestia:auth:revoke {account_id, sid:"all", closeCode:4031}   # kicks live socket now
```
**Three defense layers, strongest→weakest:** (1) pub/sub kick evicts the live socket in seconds; (2) `uversion` bump + `revoked:sid` block any reconnect/refresh immediately; (3) 10-min access TTL guarantees death even if (1) and (2) are missed.

### Outage stances (no bypass windows)
- **Bot REST 5xx at login:** fail-**closed** for new/unknown users. Fail-**soft to recent cache** ONLY to *refresh an existing* entitled session within the staleness window — **never to authorize a brand-new login** (closes the "Discord-outage fail-soft mints new sessions" bypass). Such sessions are flagged `verification_method='stale_cache'`.
- **Gateway gap:** every reconnect is treated as a **cache-invalidation event** — refresh forces an authoritative bot REST check for any session whose `gate.checked_at` predates the last gateway (re)connect (closes the "gateway-outage retained alpha" bypass). Plus hourly reconcile paginating `GET /guilds/<GID>/members` to rebuild the SET. The `/auth/refresh` fast path trusts `SISMEMBER` **only** when the cache post-dates the last reconnect.
- **Bot kicked / intent lost:** loud ops alert; fall back to user-token `GET /users/@me/guilds/<GID>/member` at login *only* if the user granted the scope; else fail-closed `verification_unavailable`.
- **`GUILD_DELETE unavailable:true`** (Discord outage) → do **NOT** revoke. **Member timeout** (`communication_disabled_until`) → not a revocation signal.

---

## 6. Data Model + Colyseus `onAuth`

### 6.1 Postgres
```sql
CREATE TYPE account_status AS ENUM ('active','suspended','banned','deleted','guest');
CREATE TYPE idp_provider  AS ENUM ('discord');     -- ALTER ... ADD VALUE 'google','apple' later. NEVER 'telegram'.
CREATE TYPE entitlement_type AS ENUM ('alpha_access','beta_access','founder');

CREATE TABLE accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- == JWT sub (canonical subject)
  display_name  text,
  status        account_status NOT NULL DEFAULT 'active',
  token_version int  NOT NULL DEFAULT 1,          -- mirrors Redis uversion:<id>; global kill lever
  banned_until  timestamptz, ban_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE TABLE external_identities (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider          idp_provider NOT NULL,
  provider_user_id  text NOT NULL,                -- Discord snowflake
  provider_username text, email text,
  access_token_enc  bytea,                         -- NULL for Discord (we do not store user tokens)
  refresh_token_enc bytea,                         -- NULL
  token_expires_at  timestamptz,
  linked_at timestamptz NOT NULL DEFAULT now(), last_login_at timestamptz,
  UNIQUE (provider, provider_user_id),             -- global identity uniqueness
  UNIQUE (account_id, provider)                    -- one identity per provider per account
);

CREATE TABLE refresh_token_families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- == sid in JWT
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  client_type text NOT NULL,                       -- web|desktop|mobile|telegram
  device_secret_h bytea, user_agent text, ip inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz, revoked_reason text
);

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- generation id
  family_id uuid NOT NULL REFERENCES refresh_token_families(id) ON DELETE CASCADE,
  prev_id   uuid REFERENCES refresh_tokens(id),
  token_hash bytea NOT NULL,                        -- sha256(secret); raw never stored
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz                               -- set on rotation; re-presentation => REUSE
);
CREATE INDEX ON refresh_tokens (family_id);

CREATE TABLE entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  type entitlement_type NOT NULL,
  source text NOT NULL,                             -- 'discord_guild_role'
  source_ref jsonb NOT NULL,                        -- {guild_id, role_id}
  granting_identity_id uuid REFERENCES external_identities(id),  -- multi-IdP seam
  last_verified_at timestamptz NOT NULL,
  verification_method text,                         -- 'bot_rest'|'gateway_event'|'oauth_scope'|'stale_cache'
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz, revocation_reason text,   -- 'left_guild'|'role_removed'|'role_deleted'|'manual'
  UNIQUE (account_id, type)
);
```
Find-or-create is race-safe via `INSERT ... ON CONFLICT (provider, provider_user_id) DO UPDATE ... RETURNING account_id`. Entitlement is a property of the **account via `granting_identity_id`**, never of the current login.

### 6.2 Colyseus `onAuth` (offline verify + Redis overlay; **no NestJS round-trip**)
```ts
import { CHANNELS, hasEntitlement, verifyJwt } from "@celestia/auth-contract"; // frozen constants + shared helpers

async onAuth(client, options, context) {
  const token  = options?.token;             // via SDK auth options, NEVER the wss:// URL
  const ticket = options?.ticket;
  if (!token || !ticket) throw new ServerError(4000, "no_token");

  let c; // claims
  try {
    c = await verifyJwt(token, {             // JWKS cached in-process; last-known-good on fetch failure
      iss: "https://api.celestia.gg", aud: "celestia-realtime",
      algorithms: ["EdDSA"],                 // PINNED; symmetric never accepted
      clockTolerance: 60,                    // seconds; covers nbf/exp skew
    });
  } catch { throw new ServerError(4000, "bad_token"); }

  if (!hasEntitlement(c, "alpha")) throw new ServerError(4030, "no_alpha");

  // proof-of-possession: single-use connect ticket, bound to this exact session
  const t = await redis.call("GETDEL", `connect:${ticket}`);
  if (!t) throw new ServerError(4012, "ticket_invalid_or_used");
  const tk = JSON.parse(t);
  if (tk.account_id !== c.sub || tk.sid !== c.sid || tk.jti !== c.jti)
    throw new ServerError(4012, "ticket_mismatch");

  // live-revocation overlay — ONE Redis pipeline, keyed on canonical account_id (c.sub)
  const [uver, revJti, revSid, banned] = await redis.mget(
    `uversion:${c.sub}`, `revoked:jti:${c.jti}`, `revoked:sid:${c.sid}`, `ban:${c.sub}`);
  if (uver !== null && Number(uver) !== c.ver) throw new ServerError(4031, "revoked"); // GLOBAL kill
  if (revJti)  throw new ServerError(4011, "session_revoked");
  if (revSid)  throw new ServerError(4011, "session_revoked");
  if (banned)  throw new ServerError(4010, "banned");

  await redis.sadd(`presence:acct:${c.sub}`, `${process.pid}:${this.roomId}:${client.sessionId}`);
  return { accountId: c.sub, sid: c.sid, ent: c.ent, discordId: c.did };
}

onLeave(client) {
  redis.srem(`presence:acct:${client.auth.accountId}`, `${process.pid}:${this.roomId}:${client.sessionId}`);
}
```
Each Colyseus process subscribes once to the frozen channel and kicks matching live sockets:
```ts
sub.subscribe(CHANNELS.AUTH_REVOKE);  // === "celestia:auth:revoke"
sub.on("message", (_c, raw) => {
  const { accountId, sid, closeCode } = JSON.parse(raw);
  for (const room of gameServer.rooms())
    for (const cl of room.clients)
      if (cl.auth.accountId === accountId && (sid === "all" || cl.auth.sid === sid))
        cl.leave(closeCode ?? 4031);
});
```
**WS close/error codes (frozen):** `4000` bad/no token · `4010` banned · `4011` session revoked · `4012` ticket invalid · `4030` not alpha · `4031` entitlement/global revoked.

---

## 7. Security Requirements Checklist

Every red-team exploit/bypass/inconsistency/missing item appears here as a **MUST** with its mitigation. CI enforces the contract items.

- **MUST-1 — Single revocation channel + global check (ranked risk #1).** NestJS and Colyseus import `CHANNELS.AUTH_REVOKE = "celestia:auth:revoke"` and all overlay keys from `@celestia/auth-contract`; no service re-declares them. Colyseus `onAuth` MUST perform the `uversion:<sub> == ver` check **and** `revoked:jti`/`revoked:sid`/`ban`. An integration test (MUST-13) asserts a real `PUBLISH` kicks a live socket.
- **MUST-2 — Telegram handoff has a server-authoritative portable binding (ranked risk #2).** The PKCE verifier is **server-side** for Telegram (Pattern B); `/auth/exchange` takes **no `code_verifier`** field. The code is bound to `tg_user_id` (from freshly validated initData) **AND** `device_secret_h` **AND** `init_nonce`, all re-checked server-side; mismatch burns the code and revokes the family. A sniffed `t.me` link is bearer-useless on another device/account.
- **MUST-3 — One pinned signing algorithm (ranked risk #3).** EdDSA (Ed25519) org-wide, explicitly pinned on the signer and **every** verifier (`algorithms:["EdDSA"]`). Symmetric algs are never in any accept list, eliminating RSA-public-key-as-HS256 confusion. JWKS carries only Ed25519 public keys.
- **MUST-4 — No long-lived refresh in JS-readable storage (ranked risk #4).** The Mini App MUST NOT store the refresh token in `CloudStorage`/`localStorage`. It uses an httpOnly `SameSite=Strict` cookie on `api.celestia.gg` (body-based refresh) if the WebView holds it, else **memory-only with re-auth**. Native uses OS secure storage. Web access tokens live in memory only.
- **MUST-5 — Isolate the bot token from the auth validator (bot-token compromise).** initData is validated with **Telegram's Ed25519 third-party signature** (Telegram's published public key), so the auth service never holds the bot token. The gateway/REST gate bot runs as a **separate process with its own secret scope**. A single breach cannot both forge initData and read the signer key.
- **MUST-6 — Canonical subject + key derivation (ranked risk #5).** `sub = account_id` everywhere. Every revocation write and every `onAuth`/`refresh` read derives from `account_id`. The `discord_id → account_id → sid` resolution lives in one documented module. Gate caches keyed by `account_id`.
- **MUST-7 — Canonical entitlement claim.** `ent: ["alpha"]`; both issuer and Colyseus call the shared `hasEntitlement(claims,"alpha")` helper. A contract test (MUST-13) fails CI if the shapes diverge; no dev may loosen the check to a truthy test.
- **MUST-8 — Close the gateway/Discord-outage gate windows (ranked risk #6).** Treat every gateway reconnect as cache-invalidation and force an authoritative bot check on refresh for stale sessions; shorten reconcile cadence; fail-soft-to-cache may only refresh **existing** sessions, never authorize a new login.
- **MUST-9 — Proof-of-possession on Colyseus connect (ranked risk #8).** A single-use `connect:<ticket>` (TTL 30 s, `GETDEL`), bound to `{account_id,sid,jti}`, is required alongside the JWT, passed via SDK auth options — **never** in the `wss://` URL. A stolen bearer alone cannot open a room; a logged upgrade request leaks nothing reusable.
- **MUST-10 — Login CSRF / mix-up.** `state` is single-use in `oauth:txn:<state>` and verified at callback; `iss` and exact allowlisted `redirect_uri` validated; `oauth:txn` namespaced per IdP (`idp` field) for future multi-IdP.
- **MUST-11 — Rate limiting on all `/auth/*`.** Per-IP, per-`device_secret_h`, per-`tg_user_id` sliding windows (`fail:*`), plus a cap on `oauth:txn` creation to prevent Redis-exhaustion DoS. Generic `401`s, timing-safe compares, CSPRNG opaque codes — no enumeration oracle.
- **MUST-12 — Clock skew.** Signer sets `nbf = iat`; all verifiers allow ±60 s tolerance on `nbf`/`exp`.
- **MUST-13 — Issuer↔verifier contract test.** CI test mints a token and asserts Colyseus accepts it, that a `PUBLISH` on the frozen channel kicks a live socket, and that claim shape/alg/`sub`/`ent` match. Blocks the drift class of findings.
- **MUST-14 — JWKS resilience.** Colyseus pre-warms JWKS at boot, caches by `kid`, keeps the previous `kid` across rotation (overlap ≥ access TTL + skew), and serves from last-known-good if JWKS is briefly unreachable — no cold-start/unknown-kid DoS. Rotation: publish new `kid`, sign after propagation delay, drop old key only after old tokens expire.
- **MUST-15 — Web XSS is a minting oracle, not a 10-min leak.** Accepted as inherent; mitigated with strict CSP + Trusted Types to prevent XSS, the single-use connect ticket (MUST-9) so an exfiltrated bearer can't open a second socket, `/auth/refresh` protected by `Origin`/`Sec-Fetch-Site` + double-submit, and per-session refresh-velocity monitoring/alerting.
- **MUST-16 — Custom-scheme hijack (mobile).** Default to verified App Links / Universal Links; a bare `celestia://` scheme is a last-resort fallback only. Because native uses Pattern A (JWTs returned in the POST body, never via the redirect) a hijacked `code` is useless, and `device_secret` is required at exchange.
- **MUST-17 — initData replay.** `auth_date ≤ 300 s` freshness **plus** a `initdata:seen:<sha256>` replay cache (EX300) so a captured-but-fresh initData cannot be reused within the window.
- **MUST-18 — Logout / upstream Discord.** We hold no Discord token at rest (user token revoked right after `/users/@me`), so there is nothing to revoke upstream; Discord SSO persisting is accepted and documented. Local logout revokes the family; `/auth/logout/all` bumps `uversion`.
- **MUST-19 — Multi-IdP link conflict.** On `UNIQUE(provider,provider_user_id)` collision, **fail closed** and route to a documented, authenticated manual-merge process (ticketed, identity-verified) — never auto-merge, never social-engineerable self-serve merge; `UNIQUE(account_id,provider)` keeps one identity per provider.
- **MUST-20 — Loopback hardening (desktop).** Bind `127.0.0.1` (not `localhost`), pre-register a fixed port + 2–3 fallbacks (Discord requires exact `redirect_uri` match, no RFC 8252 port leniency); client verifies `state` locally before proxying; PKCE + confidential exchange neutralize a stolen loopback `code`.
- **MUST-21 — Fail-closed on Redis loss.** Expired/missing `oauth:txn` (>300 s) or `handoff` (>60 s) fails with a clear retry; the flow **never** falls back to minting without the gate.
- **MUST-22 — MFA / step-up (threat model).** For alpha, Discord-account compromise ⇒ alpha access is an accepted risk (documented); no step-up now. Revisit for GA (§8).

---

## 8. Open Decisions

1. **Native hardening:** move Desktop/Mobile to Pattern B (handoff code, Discord code never on device) vs the specified Pattern A (honors literal "public clients use PKCE"). Pattern A is primary for now.
2. **Access TTL (10 min)** vs revocation-latency target vs `/auth/refresh` + JWKS QPS. Consider shorter for alpha.
3. **Mini App refresh persistence:** httpOnly cookie on `api.celestia.gg` across the WebView lifecycle vs memory-only + re-auth. Pending a reliability test of Telegram's WebView cookie handling.
4. **Fail-soft staleness window** when the bot is down (how old an existing entitlement may be and still refresh) — propose ≤30 min, degraded-flagged.
5. **Gate cache TTL (300 s)** vs Discord REST rate limits; reconcile cadence (hourly proposed) and sweep via `Request Guild Members` chunks vs REST pagination.
6. **Beta tier semantics:** separate `BETA_ROLE_ID` + feature flags vs alpha superset.
7. **Higher-assurance native binding:** add a device keypair signing `/auth/exchange`/`/auth/callback` beyond `device_secret`.
8. **GA guest accounts** (`status='guest'`, zero identities, link-to-Discord upgrade): schema supports it; keep disabled during alpha — confirm. Phase-0 single-player sandbox is the "try without login" surface.
9. **Multi-guild alpha** (if it ever spans >1 guild): how `granting_identity_id` + role-holder SETs generalize.
10. **Session cap per account** + a device-management/revoke UI in `/auth/me`.
11. **Should `/auth/exchange` stay Telegram-only** to minimize the one-time-code surface (native uses Pattern A body return; web uses cookie).
12. **MFA / step-up and account-recovery threat model for GA** (out of scope for alpha per MUST-22).
13. **Uniform handoff code vs skip-for-web** (§2A.2): run the one-time code on *every* launch (one auth path, redundant web exchange) vs cookie-direct for same-origin web and code only for cross-context. Recommend uniform; freeze the choice.
14. **Tester method for networked environments** (§2A.3): `DevAuthMethod` (shared secret) is local-only; anything reachable over the internet (shared staging) should use the team-restricted `MagicLinkMethod` + `tester_allowlist`, not the shared secret. Confirm the staging posture and the allowlist's source of truth (DB table vs config).
