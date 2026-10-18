<!-- The near-term build sequence to move the P1.5 as-built onto the PIPELINE.md model: Polaris = pure
     help desk, Atlas = all game (lobby + world + action pipeline), one connection, one writer per table.
     Three slices, S1 → S2 → S3. Target model: docs/PIPELINE.md. Distinct from docs/BUILD-PLAN.md (the broad
     Phase-0 vision, partly superseded by the as-built). Codenames per NAMING.md. -->

# REFACTOR.md — S1 → S2 → S3: reaching the PIPELINE model

**Status:** **S1 + S2 + S3 built (server-side)** — S1: badge-only auth · characters + Janus lobby on Atlas ·
standalone Polaris · seat-reservation zone entry. S2: Caelum config loader + boot graph-validation · zone-
parameterized rooms · server collision · map hand-over · Atlas-internal portal transitions · resume-at-last-zone.
S3: the **Fornax** action pipeline (`enumerate→allow→qualify→execute→event→signal`) + **Astraea** gates +
`EventSink`/`SignalBus` seams + the first (lever) interaction. **Server-finish (post-S3):** the DB write-ownership
GRANT split (S1 move 6 — `0003_grants.sql` + per-service roles); **ban/revocation enforcement** (login status
gate → 403, Polaris `ban` CLI that sets status + burns the refresh chain, fail-closed status gates at the lobby +
zone doors, a **Themis** `SessionRegistry` + revocation sweep that evicts a sitting banned player); and **durable
event-sourcing** (`0004_event_log.sql` — `log.event`, per-zone hash chain, append-only by GRANT; `DurableEventSink`
behind the untouched port). All typecheck + unit tests green (60: Caelum 10, Atlas 38, Polaris-pure 12), hardened
against an adversarial review (13 confirmed defects fixed, incl. unhandled-rejection crash-safety, persist-before-
commit for G4, and a prod fail-open on the per-service DB URL). Awaiting Postgres/Docker only for *live
verification* (GRANT behavior · append/replay · cross-socket kick/displacement). The Valkey instant-kick, replay
projection, and `qualify` typed-requirement dispatch are deferred with triggers. The Phaethon client rewrite +
render + live interaction (J5 / S2 move 3) is deferred with the client. The sequence that aligns the P1.5
as-built with `docs/PIPELINE.md`.
**Owners:** Platform / Engine. **Reads with:** `docs/PIPELINE.md` (the target), `docs/CHARACTERS.md`,
`docs/AUTH.md`, `docs/WORLDS.md`, `.context/architecture/guardrails.md`.
**LLM is OFF for all of this** — no cognition backend; the "`enumerate` = LLM option-set" term-alignment pass
rides with it, deferred.

**Order (locked):** **S1 → S2 → S3.** S1 is the foundation (the connection/ticket/ownership model everything
else sits on); S2 builds the config-driven world on it; S3 is the in-game action engine. S3 is **its own
mini-module** (like Caelum) — Atlas ends up hosting named subsystems.

---

## Atlas module map

Atlas is a NestJS host composing named mini-modules (all DI-wired). **Caelum** is shared via
`@celestia/firmament` (Polaris + Atlas both load it at boot); the rest are Atlas game-side — genre-neutral
mechanisms that can extract to engine packages later (G3).

| Module | Responsibility | Slice | Status |
|---|---|---|---|
| **Caelum** | config/topology loader — world → zones → map/sectors (shared via `@celestia/firmament`) | S2 | now |
| **Janus** | Lobby — the gateway into the game: world + character selection | **S1** | now |
| **Orrery** | the game loop — movement, AoI/sectors, zone transitions, the tick | S2 | now |
| **Astraea** | in-game authz — the `allow()` / `qualify()` action gates | S3 | now |
| **Fornax** | the action pipeline — thin orchestrator (`enumerate→allow→qualify→execute→event→signal`); hosts the EventSink + signal-bus seams | S3 | now |
| **Themis** | in-game moderation/enforcement — punishing abuse (chat spam, harassment) | — | reserved |
| **Iris** / **Hermes** | social — two purposes (chat / presence / friends) | — | reserved |

The action pipeline (**Fornax**) **threads two of these**: the gates (`allow`/`qualify`) are **Astraea**; the
write (`execute → event → signal`) is **Orrery**; Fornax is the thin orchestrator that runs the whole sequence.
So "game loop" and "in-game authz" aren't rivals — they're two stages of one pipeline, each its own module.

---

## S1 — Polaris → pure help desk

**Goal:** Polaris does only `login → one signed access badge`. All character/game data + the character lobby
move to **Atlas**. One connection. One writer per table.

**Moves**
1. **One access badge.** Collapse the session-ticket + zone-ticket pair into a single signed **access badge**
   (`aud:"access"`, carries `{ accountId, role }`), issued on login/refresh. `firmament/TicketService`:
   `signAccessToken`/`verifyAccessToken` (keep EdDSA — Polaris signs, Atlas verifies offline). Retire
   `signSessionTicket`/`signZoneTicket`.
2. **Characters → Atlas.** Move `game_character` + `CharacterStore`/`CharactersService` from Polaris to Atlas
   (`character_placement` is already Atlas's). Migration `0002` becomes Atlas-owned.
3. **Lobby → Atlas.** The session-gateway logic (`session.state` / `character.create` / `play.enter`) leaves
   Polaris. Atlas gains a **lobby** (character list / create / select) on the single connection, before a zone.
4. **One connection + one session/account** enforced on the Atlas connection (`onAuth` verifies the badge;
   a new connect displaces the old — invariant).
5. **Polaris shrinks** to `AuthController` (login/refresh/logout) + `AccountsService` + `grant` CLI +
   `/health`. Remove the WS `SessionGateway` and `CharactersService` from Polaris.
6. **DB write-ownership (GRANTs).** Per-service DB roles: **Polaris** RW on `account`/`auth_identity`/
   `refresh_token`/`role`; **Atlas** RW on `game_character`/`character_placement`/`log.event`/world. A migration
   creates the roles + GRANTs — Atlas's role has **no write** on account/auth tables (the enforced invariant,
   `PIPELINE.md §3`).

**Built (typecheck-green; DB acceptance tests pending Postgres):** moves 1–5 done. The access badge is the ONLY
ticket (`TicketService.signAccessToken`/`verifyAccessToken`; session + zone tickets removed). `CharactersService`
+ the lobby (**Janus**, `services/atlas/src/janus/lobby.room.ts`) are Atlas-native; Polaris is pure HTTP (no WS,
no game data). One connection + one-session/account is enforced in the lobby's `onAuth`/`onJoin`. **Enter → zone
is an Atlas-internal seat reservation** — the lobby `matchMaker.reserveSeatFor`s the target zone room with the
verified `{accountId, characterId, zoneId, role}` as `authData`, so the zone room's `onAuth` is skipped on
consume (and rejects *direct* joins); the client never asserts who it is (G1/G11). **Remaining:** move 6 (the
per-service DB GRANT split) — now **built**: `0003_grants.sql` creates `polaris_app` / `atlas_app` with the
grant matrix (Atlas has **no write** on auth tables; `SELECT` on `account` for the FK only), each service
connects as its own role via `PersistenceModule.forService(...)`, and the migrate runner passwords the roles
from env (secrets never in SQL — G8). Live GRANT behavior awaits Postgres (no Docker in sandbox). The POC
client (Phaethon) still rides the transitional `zoneTicket?` field and gets rewritten next (J5).

**Done when:** `POST /auth/:method` → `{ refreshToken, accessBadge }` (no session/zone ticket); Polaris has no
character endpoints and no WS gateway; the client connects **once** to Atlas with the badge; Atlas owns
character create/list/select + placement; the GRANT split is in place (Atlas role rejects a write to `account`).

**Defers:** lobby UX polish; multi-world/realms.

## S2 — Caelum (config loader) + Atlas zone refactor

**Goal:** server reads config at boot → a validated world/zone registry (**Caelum**); Atlas becomes
zone-parameterized; dummy maps (walkable/boxes + a portal) load and hand to the client; server-side collision;
Atlas-internal zone transition.

**Moves**
1. **Caelum** in `@celestia/firmament`: read `config/world.json` (manifest: worlds → zone-id list + starting
   zone + world knobs) + `content/zones/<id>/zone.json` (tickHz, spawn, maxPerChannel, `map` ref) +
   `content/zones/<id>/map.json` (dummy: `{ width, height, tileSize, tiles[][] (0=walkable,1=box), spawns, portals }`).
   **Validate the graph at boot** — every zone id has a bundle + resolvable map; every portal target resolves to
   an existing zone + named spawn; dangling → boot fails. Eager registry; rooms instantiate lazily.
2. **Atlas zone-parameterized.** One `ZoneRoom` class; `joinOrCreate("zone", { zoneId })` + `filterBy(['zoneId'])`
   (also the channel seam). `onCreate` loads the zone's config from Caelum; builds the sector grid from map bounds.
3. **Map hand-over + render.** Atlas sends the zone's map on join (`"zone.map"` message, not synced state);
   Phaethon renders a basic tile grid (floor + boxes).
4. **Server collision.** `MovementSystem` rejects a move whose target tile is a box (point-vs-tile; bounds from
   the map). No sliding/AABB yet.
5. **Zone transition (Atlas-internal, no Polaris, no new ticket).** Portal tile → source room validates you're
   on it (owns your position, G1) → `matchMaker.reserveSeat` into the target zone room at the named spawn →
   client consumes → `onJoin` at spawn → persist the new `zone_id`. *(The seat-reservation mechanic is now proven
   by S1's enter handoff: `matchMaker.reserveSeatFor(room, opts, authData)` pre-attaches identity and SKIPS
   `onAuth` on consume — the client can't override it; pattern lives in `janus/lobby.room.ts`.)*
6. **Entry resolves the zone:** lobby/enter uses the saved `character_placement.zone_id` (resume) else the
   manifest's starting zone.

**Built (typecheck + unit tests green; the live boot/walk/portal acceptance needs a running Atlas + Postgres):**
Caelum (`packages/firmament/src/caelum`) loads `config/world.json` + `content/zones/*` into a validated
`WorldRegistry` and FAILS BOOT on dangling topology (10 unit tests, incl. loading the real shipped content). It's
DI-wired (`@Global CaelumModule`) into Atlas; the lobby + zone rooms read it. `ZoneRoom` is zone-parameterized
(per-instance `zoneId` → zone from the registry; spawn resolved saved-placement → named spawn → `default`).
`MovementSystem` rejects moves into box tiles (point-vs-tile, unit-tested). The zone hands its map to the client
on join (`MSG.zoneMap`). Portals transfer Atlas-internally: step on a portal → `reserveSeatFor` the target zone at
the named spawn → persist the new `zone_id` → `MSG.zoneTransfer` → client consumes + crosses (shared
`rooms/seat-reservation.ts`). Enter resolves the zone from saved placement, else the manifest starting zone. The
**Orrery** scope (loop/collision/transition) lives in `ZoneRoom` + the ECS systems for now; extracting it into a
named module is a later refinement. **Remaining:** move 3's Phaethon render (rides the client rewrite, J5) + the
live boot/walk/portal acceptance (needs Docker/Postgres).

**Done when:** server boots from `config/world.json` + `content/zones/*` (invalid topology fails boot); the
client joins `genesis` from config and renders the dummy map; you can't walk through boxes; stepping on the
portal moves you to zone #2 at the named spawn and persists it; re-login resumes at the last zone.

**Defers:** real Tiled `.tmj`; AoI/StateView per sector; channels (multi-process + Valkey); world heartbeat /
zone-event state.

## S3 — the action-pipeline module (its own mini-module, like Caelum)

**Goal:** a named Atlas sub-module implementing the in-game action pipeline
`enumerate → allow → qualify → execute → event → signal`, with the `EventSink` seam + the signal bus, proven by
the first interaction (a lever). Builds on **Slice A** (ECS `World`/`MovementSystem` — already on disk, done).

**Moves**
1. **The pipeline module** (**Fornax** — `services/atlas/src/fornax`): `enumerate(resources)` (load targets) →
   `allow(accesses)` (access gate — reads the badge role) → `qualify(states)` (in-game gate — reads game state) →
   `execute` (write) → `event` → `signal`. Deny-by-default; short-circuit on first failure.
2. **`allow()`** — the access chokepoint (G6), reads the badge role/entitlement; minimal rules now.
3. **`qualify()`** — typed-requirement dispatch (checker-per-type → AND); minimal now.
4. **`EventSink` port** (G7) + an in-memory adapter. Durable `log.event` (hash chain + `DurableEventSink`) was
   integrated behind the SAME port in the server-finish pass (no call-site change); replay/projection is deferred.
5. **Signal bus** — in-memory `emit`/`on`; live reactive glue (not persisted; distinct from the event log).
6. **First interaction — a lever.** `interact` intent → pipeline → a `lever_toggled` event into the sink → a
   reducer flips a synced bit → a signal fires. Proves the whole loop end-to-end.
7. **norma:** add `interact` + `InteractCommand` (intentionally, this time).

**Built (unit-tested; the live client interaction rides the client rewrite, J5):** **Fornax**
(`services/atlas/src/fornax`) runs `enumerate → allow → qualify → execute → event → signal`, deny-by-default,
short-circuiting (6 unit tests: the full loop + each stage's denial leaking no write/event/signal). Gates =
**Astraea** (`astraea.ts`: `allow`/`qualify` helpers); write side = the `EventSink` port (in-memory now, durable
`log.event` later behind the same port) + the `SignalBus`. The first interaction — a **lever** — is a registered
`ActionDef`; `interact` + `InteractCommand` are in norma. `ZoneRoom` wires it: a synced `LeverState`, an
`interact` message → `pipeline.dispatch` with the actor from the verified seat authData (never the client) + a
reach gate, and a signal listener that logs the toggle. The logic lives in Fornax, not `ZoneRoom`. The pipeline
persists each event BEFORE committing/broadcasting the state mutation (persist-before-commit), so a failed
durable append never leaves the world ahead of the log (G4). **Built since (server-finish):** durable
event-sourcing — `0004_event_log.sql` + `fornax/event-chain.ts` (hash chain + `verifyChain`) + `DurableEventSink`
behind the port. **Deferred:** replay/projection over the log; typed-requirement dispatch for `qualify`; the
client-side interaction (J5).

**Done when:** an `interact` on a lever runs the full pipeline — toggles the synced state, appends one event to
the sink, fires a signal (unit-tested); unknown action/resource/failed gate is rejected (deny-by-default); the
logic lives in the module, not in `ZoneRoom`.

**Defers:** replay/projection over the durable log (the `log.event` hash chain itself is built); combat/items/economy (more event
types); the `fence`/`barrier` special cases; the LLM option-set (and its naming).

---

## Deferred across the whole plan

LLM / cognition backend + the `enumerate`-term alignment pass · durable event-sourcing · multi-world/realms ·
channels / AoI / world heartbeat · web3. All ride on the seams S1–S3 lay; none is retrofit.

## Relationship to `BUILD-PLAN.md`

`BUILD-PLAN.md` is the broad Phase-0 vision (Telegram Mini App, Mica calibration + transport spikes, cozy
life-sim). The architecture has since evolved (NestJS Polaris/Atlas, session-first auth, the help-desk/pipeline
model). **This doc is the concrete near-term sequence for the current as-built;** reconciling `BUILD-PLAN.md`
with the as-built is a separate flagged task, not part of S1–S3.
