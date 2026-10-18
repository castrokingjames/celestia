<!-- Design authority for the post-login flow + the character/placement model. Reconciles with
     PLATFORM.md §6 (four-tier scoping), AUTH.md (Decision P1.5 — session-first auth). Codenames per NAMING.md. -->

# CHARACTERS.md — Post-login flow, the character model, zone entry

**Status:** **PLANNED — being built now (P1.5).** No `character` exists yet in code; today login hands
straight to a blank avatar at the origin (§1). **Transport is session-first** (`AUTH.md` Decision P1.5): the
post-login surface rides **one bound, connection-capped session**, not REST — see §4–§5. The "As built"
note in §9 tracks what has actually landed.
**Owners:** Platform / Engine.
**Reads with:** `docs/AUTH.md` (identity, sessions, **the session-first decision**), `docs/PLATFORM.md` §6
(scoping), `docs/REALTIME.md` (the zone sim), `.context/architecture/guardrails.md` (G3, G11).

---

## 1. The question this answers

*What happens the instant after a successful login?* Today it is a straight shot with **no identity in the
world**:

```
login ──▶ POST /auth/ticket ──▶ connect to Atlas ──▶ spawn a blank Player() at (0,0)
```

`ConnectTicketClaims = { accountId, role }`; `ZoneRoom.onJoin` makes `new Player()` at the origin and
**nothing persists** — position dies on disconnect, no name, no save. Fine for a netcode POC, wrong for a
game. This doc defines the real flow: **account → character → zone**, carried over the bound session.

## 2. Where it sits in the scope model (account ≠ character)

Celestia is an engine hosting many games (`PLATFORM.md`). The four-tier scoping (§6 there) tells us exactly
where these live:

| Thing | Tier | Keyed by | Crosses games? |
|---|---|---|---|
| **account** | PLATFORM-GLOBAL | `account_id` | **yes** — identity / login / ban / billing |
| **character** (the "save") | PER_PLAYER | `(account_id, game_id)` | no — one set of characters *per game* |
| **character placement** (where you are) | PER_PLAYER (sim-adjacent) | `character_id` | no |

**Your account is global; your character is per-game.** The `account` is the login/ban principal
(`AUTH.md`); a `character` is an account's avatar **inside one game**. One account, N characters per game —
with **N a per-game policy, not an engine rule** (§3). A 1-character game and an N-character MMO are the
**same schema**, different config.

> **One-game simplification (now):** single game, single Postgres, so `game_id` + the per-game data plane of
> `PLATFORM.md §6` are a **documented seam, not yet built** (§8). `character` lives in Polaris's DB for P1;
> it is logically per-game-plane data that migrates when game #2 lands.

## 3. The data model — engine identity vs module metadata

Follows **G3 (engine ↛ game module)**: the engine owns a *genre-neutral* save-slot identity; the game module
owns everything game-specific, in its **own** tables keyed by `character_id`. The engine must build with no
game module present — so the engine `character` row knows nothing about class, appearance, or stats.

**Engine-owned (now, in Polaris's DB):**

```
game_character                             -- the durable per-(account,game) save identity ("character" is a SQL reserved word → prefixed)
  id          uuid pk
  account_id  uuid  → account(id)          -- the login principal (stays separate)
  name        text  unique                 -- in-world display name; the only player-facing attribute the engine knows
  status      text  ('active' | 'deleted')
  created_at, updated_at

character_placement                        -- hot world-state; written every autosave by Atlas, so it is
  character_id  uuid pk → game_character(id)  -- a separate row from the near-immutable identity above
  zone_id       text                       -- which zone (default starting zone for a fresh character)
  x, y          double precision           -- last authoritative position
  updated_at                               -- facing/anim added with combat (docs/NETCODE.md backlog)
```

**Module-owned (later):** class/element, appearance, stats, inventory, relationships — each a table in the
module's own schema (`mod_<game>.*`, `PLATFORM.md §3.2`), keyed by `character_id`, **never a column on the
engine `character`.** For P1 there are **none** — `name` is the whole character.

**Cardinality is config, never code (G8 / no bare literals).** The cap is a game-module policy value:

```jsonc
// config/default.json
"game": { "maxCharactersPerAccount": 5 }   // number → a cap · null → unlimited · 1 → a 1:1 game
```

`character.create` reads this value and rejects past it; **no hardcoded number** anywhere. The limit is
surfaced to the client in the on-connect session state (`maxCharacters`) so the client does not bake it
either. (Ultimately this belongs to the GameModule's declared config, `PLATFORM.md §3.3`; `config/default.json`
is its P1 home.)

## 4. The post-login flow (session-first, cardinality-driven)

Per `AUTH.md` Decision P1.5 the client holds **no reusable access token** — it gets a rotating refresh + a
**one-time session ticket**, opens **one bound session**, and the whole pre-world flow is **messages over
that session**. The step order is the same as a classic character-select; only the transport is a capped
connection instead of sprayed REST.

```
LOGIN   POST /auth/:method  (REST)  →  { refresh (rotating), sessionTicket (one-time, short-TTL) }
   │
   ▼
OPEN SESSION   one bound connection (WSS), sessionTicket presented at the handshake
   onAuth: verify + burn jti · ENFORCE one session per account (a new connect displaces the old — invariant)
   on connect: server pushes  { account, characters[], maxCharacters }   (no separate /me round-trip)
   │
   ├─ count == 0              →  msg "character.create" { name }  → character   (rejected if count >= max)
   ├─ count == 1 && cap == 1  →  auto-select (no screen)
   ├─ cap > 1                 →  CHARACTER SELECT (+ "create" while count < cap)   → pick characterId
   │                                    │
   │                                    ▼
   │                          msg "play.enter" { characterId }
   │                            • verify the character belongs to this account (authoritative state, G1/G11)
   │                            • resolve zone  (matchmaking; default starting zone)
   │                            • mint an INTERNAL one-time zone ticket { accountId, characterId, zoneId }
   │                            ──▶ { zoneId, zoneTicket, realtimeUrl }
   │                                    ▼
   │                          connect ATLAS zone room with the zone ticket  (connection-gated too)
   │                            onAuth → verify + burn; claims carry characterId + zoneId
   │                            onJoin → load character_placement → spawn Player at (x,y)   (zone default if first time)
   │                                    ▼
   │                              PLAYING (20 Hz, docs/REALTIME.md) · autosave placement (periodic + onLeave)
   │
   └─ (later) walk to a zone edge / portal ─▶ "play.enter" re-ticket ─▶ new zone room
```

**No separate lobby/hub scene** — you land in the starting zone at your character's last position. The select
screen's existence is **derived from config** (cap `1` ⇒ never shown; `>1` ⇒ shown), not hardcoded.

## 5. Server surface — REST only for the auth handoff; everything else is session messages

| REST (handoff only) | does |
|---|---|
| `POST /auth/:method` | login == registration → `{ refresh, sessionTicket }` (**no reusable access token**) |
| `POST /auth/refresh` | rotate refresh → new `{ refresh, sessionTicket }`; replay/expired/inactive → 401 |
| `POST /auth/logout` | revoke the presented refresh (idempotent) |

| Session message | dir | does |
|---|---|---|
| `session.state` | s→c | pushed on connect: `{ account, characters[], maxCharacters }` |
| `character.create` | c→s | `{ name }` → create; refuse if `count >= maxCharacters`; name-collision handled |
| `play.enter` | c→s | `{ characterId }` → verify ownership, resolve zone, issue internal zone ticket → `{ zoneId, zoneTicket, realtimeUrl }` |

**The single bound session is the point** (`AUTH.md` P1.5): the handshake enforces **one live session per
account** (a new connect displaces the old — an invariant, not a tunable) — a thing a stateless REST surface
cannot do. The old character-less `POST /auth/ticket` is **removed**; its job splits into the one-time *session* ticket (login)
and the internal one-time *zone* ticket (`play.enter`). Ownership (does this `characterId` belong to this
account?) is checked **server-side from authoritative state**, never trusted from the client (**G1/G11**).

**Where the session gateway lives** is the one open build decision (`AUTH.md` P1.5): recommend
**Polaris-hosted WS** (keeps identity/characters in Polaris; Polaris still never ticks) over a Colyseus
lobby room on Atlas.

## 6. Atlas — load, spawn, save (zone connection)

- **`onAuth`** verifies the internal **zone ticket** (one-time `jti`), reading `characterId` + `zoneId`.
- **`onJoin`** loads `character_placement` for that `characterId` → spawns the `Player` at `(x, y)` (zone
  default spawn when there is no row yet) and sets `Player.name` from the character. Atlas reads/writes
  `character_placement` over the shared Postgres (Polaris owns identity; the running world owns placement).
- **autosave:** persist `(zone_id, x, y)` on `onLeave` + on a periodic interval — so "log back in and your
  character is where you left it" holds. Interval + the fixed-tick movement are unchanged (`docs/REALTIME.md`).

## 7. Client (Phaethon POC)

After login (`POST /auth/basic` → `{ refresh, sessionTicket }`): open the bound session with the ticket →
receive `session.state` → branch per §4 (create / auto-select / select) via `character.create` /
`play.enter` messages → connect to Atlas with the returned `zoneTicket` + `zoneId`. Render own + remote
**names** above the squares. `scripts/smoke.ts` grows a `login → session → create → enter → connect → move`
path. Phaethon is still the throwaway POC (`client/astrolabe` is the destination); this flow is what
Astrolabe re-implements over the Jupiter SDK.

## 8. Deferred seams (recorded, not built)

- **Session gateway host:** Polaris-WS vs Atlas-lobby-room — recommended Polaris; confirmed in build (§5).
- **Multi-game:** `game_id` as a first-class column + the per-game data plane (`PLATFORM.md §6`). One game,
  one DB now; characters become `(account_id, game_id)` in a per-game DB when game #2 is committed.
- **Multi-world / realms (login funnel stage ②):** the `world_id` seam + a `world.select` step + optional
  per-world character scope — single-world today. The full family analysis is in `docs/WORLDS.md`.
- **Zone transitions / multiple zones:** the zone ticket already carries `zoneId`, so edge/portal hand-off is
  additive (re-ticket via `play.enter`). One starting zone for now.
- **Channels (shards):** a population instance of a zone; Colyseus room instances give this seam via
  matchmaking when needed. One implicit room now; `channelId` not in the data model yet.
- **Character delete / rename:** `status='deleted'` is in the schema; the flows are not built.
- **Game metadata:** appearance / class / stats / inventory arrive as module-owned tables (§3) with their
  features — appearance+class ride the next character-facing feature; stats/inventory ride combat/economy.

## 9. As built (P1.5)

**Shipped — the whole flow above is live and e2e-verified.** login → bound **session gateway** (one session
per account) → `session.state` → `character.create` → `play.enter` → one-time **zone ticket** → Atlas join →
spawn at the loaded `character_placement` (name + position) → movement → write-behind save on leave + autosave.
In: migration `0002` (`game_character` + `character_placement`), `CharacterStore`/`CharactersService` (cap from
`config.game.maxCharactersPerAccount`), the Polaris `@WebSocketGateway`, Atlas `PlacementStore` + `ZoneRoom`
load/save, the Phaethon client flow + headless `scripts/smoke.ts` (login→session→create→enter→move→persist).
**Deferred (§8):** multi-game `game_id`, zone transitions, channels, delete/rename, module metadata.
