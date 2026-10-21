<!-- Implementation-ready plan for the first Celestia GameModule: a cozy-farming MMO (@celestia/game-cozy,
     codename Ceres). Built ON the genre-neutral engine, NEVER a fork (G3). The authority for WHY the boundary
     holds is docs/PLATFORM.md; this doc maps the cozy game onto it. Reads with: PLATFORM.md (spine), WORLDS.md,
     PIPELINE.md, COGNITION.md/DECISIONS.md, CHARACTERS.md, REALTIME.md, NAMING.md, .context guardrails. -->

# COZY-MMO-PLAN.md — the cozy-farming MMO on Celestia (`@celestia/game-cozy`)

**Status:** DESIGN / implementation-ready plan — not built. **Owner:** Game #1 (cozy). **Spine:** `docs/PLATFORM.md`
is authoritative and already designs this; every capability below is tagged **ENGINE-primitive** (genre-neutral,
`@celestia/*`) or **MODULE** (game meaning, `@celestia/game-cozy`). On any conflict the cited `.context/` or
`docs/` file wins.

> **Proposed codename (NAMING.md):** the cozy game module is **Ceres** — the goddess of harvest and growing
> things, a dwarf planet; "the fertile world where the farming sim lives and grows" (NAMING.md §5). Package name
> stays the PLATFORM-fixed `@celestia/game-cozy`; **Ceres** is its friendly-name. Alternatives: **Arcadia** (the
> pastoral paradise), **Spica** ("ear of grain"), **Demeter**. A new *engine* subsystem this plan needs — the
> world-level calendar/season/weather clock driver — is proposed as **Horologium** (the constellation "the Clock";
> see §5), and the mine's descent/floor manager as **Erebus** (§4.l). These are proposals, not locked.

---

## 0. One-paragraph thesis

A cozy-farming MMO is **the first `@celestia/game-cozy` module** (PLATFORM.md §1): all farming/season/villager/
economy *meaning* lives in the module; the engine supplies only mechanisms. The world is a **shared city/town at
a slow (~1 Hz) Zone tick** (calendar, seasons, weather, festivals) plus **per-player instanced farms/ranches and
descending mine floors at 20 Hz** (real-time play) — exactly PLATFORM.md's per-room-type tick driver. Dormant
farms are **DB rows, not rooms**; they reconstruct on first visit by a **deterministic compute-on-load
fast-forward** (G9). The **mine/dungeon reuses what already exists** — the monster roster (`content/mobs.json`),
per-zone spawn tables, Pallas mob AI, and the Fornax combat pipeline — so there is **no new combat engine**.
Everything the client sends is an **index/id, never a number** (G1); the server enumerates legality and computes
every value.

---

## 1. Vision & core loops

### 1.1 The fantasy

Stardew Valley / Animal Crossing / Harvest Moon, but **shared-world and server-authoritative**: a living town
whose calendar, seasons, weather, and festivals tick for everyone at once; private farms/ranches you cultivate
and **invite friends into**; villagers (NPCs) who **remember you** (Pallas/Mnemosyne, §4.i); a player-driven
**economy** of crops, crafted goods, and shops; and a **right-sized Stardew-style mine** — descending floors of
monster combat and ore-gathering — layered on the *same* engine primitives, not a bolt-on.

### 1.2 The loops (each mapped to the pipeline + a tick tier)

| Loop | What the player does | Primary tick tier | Pipeline verbs (intents) |
|---|---|---|---|
| **Daily farming** | till → plant → water → (sleep/seasons advance) → harvest → sell | farm **instanced 20 Hz** play + **Zone ~1 Hz** day/season advance | `till`, `plant`, `water`, `harvest`, `ship` |
| **Seasons & calendar** | plan crops around a 4-season calendar; weather rains/waters for you | **Zone ~1 Hz** world clock (Horologium) | (no intent — autonomous world sim) |
| **Economy / shops** | buy seeds/tools/upgrades; sell produce; ship-bin overnight sale | town Zone + instanced farm | `buy`, `sell`, `ship` (all **spend_own/EconomyService**) |
| **Villagers & social** | talk, gift, build friendship, co-op, (later) festivals/marriage | town **Zone** (SHARED villagers) | `converse`, `give_gift` (**interact_shared**) |
| **Crafting** | craft at stations (preserves jar, furnace, kitchen) | instanced farm (station is a placed object) | `craft` (**write_owned**), `place`, `pickup` |
| **Animals / ranch** | buy, feed, pet, collect (eggs/milk/wool), grow affection | ranch **instanced 20 Hz** | `feed`, `pet`, `collect`, `buy_animal` |
| **Fishing / foraging** | fish at water tiles; gather wild forageables that spawn seasonally | any zone/instanced | `fish` (minigame → option index), `forage` |
| **Building / placement** | place buildings/decor/objects; move/remove them | instanced farm | `place`, `move_object`, `pickup` |
| **The mine/dungeon** | descend floors; fight monsters (Fornax); mine ore nodes; grab loot; go deeper | mine floor **instanced 20 Hz** | `attack` (reused!), `mine_node`, `descend`, `use_item` |
| **Visiting / trading** | enter a friend's farm; co-op chores; trade items hand-to-hand | instanced farm (join by ranchId) | `trade_*` (escrow, §4.m) |

### 1.3 Design tenets (from the user decisions, baked in)

1. **Tick tiers are PLATFORM.md's per-room-type tick driver** (§5). City/world = Zone-level **slow ~1 Hz**
   (calendar/seasons/weather/global events). Farms/ranches/mine floors = **instanced rooms at 20 Hz**. The user's
   informal word **"cluster" = an instanced room** (a `player-instanced` room instance / a Channel); do not invent
   new vocabulary — it maps to PLATFORM.md room-type/instance and WORLDS.md World→Zone→Channel→Sector.
2. **Ranches/farms are visitable, 1 : 1 player, instanced** (§6). Room identity = ranch/owner id;
   `joinOrCreate(ranchId)`; first entrant (owner *or* visitor) loads the persisted mutable state + fast-forwards
   the dormant gap deterministically; last to leave persists + stamps `lastSimTime` and the room disposes.
3. **Offline progression = lazy compute-on-load fast-forward**, not continuous idle simulation (§5). Weather +
   crop/animal growth are **deterministic functions of game-time + seed** (G9) so the gap reconstructs identically
   regardless of which visitor triggers the load; plus periodic checkpoint + event-log replay for crash-safety.
4. **Permissions split** (§6, §10): who may **enter** a ranch = an access policy at join (public/friends/private);
   what a visitor may **do** inside = `allow()` deny-by-default with owner/scope read from authoritative state
   (G6) — default **look-but-don't-touch** until the owner grants co-op.
5. **Mine/dungeon = right-sized, mostly reuse** (§4.l). Descending floors, each an instanced room; per-floor
   spawns via the existing roster/spawn-table mechanism; ore nodes = harvestables on the same gather→inventory→
   economy path as crops; loot → inventory/EconomyService; deeper ⇒ tougher + better. **Not a roguelike.**

---

## 2. Mapping onto the `GameModule` contract (`@celestia/game-cozy`)

Everything here is the module implementing the PLATFORM.md §3 interface. Dependency direction (G3):
`@celestia/game-cozy → @celestia/game-contract, @celestia/engine`; the engine **never** imports it; a
`dependency-cruiser` arch-test fails on any engine→game edge. Wired only at the per-game composition root
(`engine.mount(cfg.game.driver)` where `cfg.game.driver === 'cozy'`), never from client join options.

### 2.1 Module identity

```ts
gameId = 'cozy'                     // namespaces data/tokens/deploy; stamped into every event
schemaNamespace = 'mod_cozy'        // its own Postgres schema (same GRANT discipline), §7
engineContractVersion = '<range>'  // CTK asserts ⊆ the running engine; monorepo lockstep (PLATFORM.md §6)
```

### 2.2 `declare(reg: ModuleRegistry)` — what the module registers at mount (pure data, frozen)

| Registry call | Cozy declarations (examples — full shapes in §4 & §8) |
|---|---|
| `component(...)` | `position`, `sprite` (shared-wire); `tilled`, `crop`, `wateredAt`, `growthStage` (crop plots); `inventory`, `wallet-less` (money is NEVER a component field — §10/G5); `relationship` (**per-player**), `brain` (**server-only** mob/villager AI state); `animal`, `placedObject`, `oreNode`, `mineFloor` |
| `archetype(...)` | `villager` (SHARED), `crop_plot` (PER_PLAYER, instanced), `inventory` (PER_PLAYER), `animal` (PER_PLAYER, `scope:'dynamic'` so it can later be sold/traded), `placed_object` (PER_PLAYER), `ore_node` (SHARED-within-floor), `monster` (SHARED-within-floor; **reused from the existing roster**) |
| `action(...)` | the intent vocabulary of §4 (`till`, `plant`, `water`, `harvest`, `ship`, `buy`, `sell`, `give_gift`, `converse`, `craft`, `place`, `pickup`, `feed`, `pet`, `collect`, `fish`, `forage`, `mine_node`, `descend`, `trade_*`) — each tagged with **one** closed `authzClass` + a `locate` that returns ids only (amount fields rejected, G1) |
| `progression(...)` | friendship bands, skill levels (farming/mining/fishing/foraging), season/day reducers; `terminal: null` (open-ended life-sim — PLATFORM.md §5) |
| `economy(...)` | currency `COIN` (`decimals:0`, `is_token:false`, non-withdrawable), item ids (seeds/crops/bars/fish/forage/artisan goods), reason codes (`crop_sale`, `seed_purchase`, `tool_upgrade`, `ore_sale`, `animal_product_sale`, `building_purchase`), faucet caps, sinks |
| `decisionSchema(...)` | `npc_gift_reaction`, `npc_daily_schedule`, `npc_converse_topic` (villagers); **mob AI schemas already exist** and are reused for the mine (§4.i/§4.l) |
| `dialogue(...)` | persona prefixes per villager, scoped recall query (Mnemosyne), the `allowedIntents` JSON-schema for S2 candidate intents (gift-accept, quest-offer) |
| `event(...)` | `cozy.tilled@1`, `cozy.planted@1`, `cozy.watered@1`, `cozy.harvested@1`, `cozy.crop_grown@1`, `cozy.gift_given@1`, `cozy.crafted@1`, `cozy.object_placed@1`, `cozy.animal_fed@1`, `cozy.product_collected@1`, `cozy.ore_mined@1`, `cozy.floor_descended@1`, `cozy.day_advanced@1`, `cozy.season_changed@1`, `cozy.weather_rolled@1` — each with a **pure** `apply()` reducer (G4/G9) |
| `assetKind(...)` | `animal` (`tradeable:true, portable:true`, stateSchema = species/affection/age/lastFed), `tool` (`tradeable:true`), later furniture; plots are **not** an asset kind (fixed, non-transferable — PLATFORM.md §2.1 row 2) |
| `roomType(...)` | `town`, `farm`, `ranch`, `mine_floor` — see §2.4 |
| `content(...)` | the Caelum-validated manifests of §8 (crops, items, recipes, villagers, shops, calendar, fish, forage, animals, ore, mine floors) |

### 2.3 Lifecycle + pipeline hooks the module implements (PLATFORM.md §3.2)

- `onRoomCreate(room, caps)` — **farm/ranch/mine-floor:** load persisted mutable state from `mod_cozy` by room id, then **deterministic fast-forward** from `lastSimTime` → now (§5). **town:** subscribe to the world clock.
- `onJoin(p, caps)` — warm-load the joiner's PER_PLAYER save slices (inventory, relationships for villagers present, skill levels). Module-tunable warm vs lazy (PLATFORM.md §3.2).
- `onTick(t, caps)` — SYNC, ≤ budget, never awaits cognition: advance crop/animal growth for the **current instant** on fast rooms; drive mob AI dispatch on mine floors; on the **town** room the ~1 Hz tick advances the calendar/weather and emits day/season events.
- `onLeave / onRoomDispose` — **last leaver of a farm/ranch/mine floor** persists state + stamps `lastSimTime`, then Colyseus disposes (§6). Town is persistent-pinned.
- `resolveResource(i, w)` — id → `{scope, ownerAccountId}` read from **authoritative state** (the plot's/animal's owner, the villager's SHARED scope), never the client payload (G1/G6).
- `enumerate(r, w, actor)` — **pure legality**: is this plot tilled + holding a seed + in-season for `plant`? is the crop ripe for `harvest`? is the villager not mid-conversation for `converse`? is this monster in range + alive for `attack`?
- `execute(ctx, caps)` — compute every number (yield, sale price, damage, affection delta) and emit events; effects only via `caps` (never Postgres/Valkey directly).
- `buildDecisionFrame / onDecision / buildDialogueRequest / onDialogueIntents` — villager cognition (§4.i), reusing the mob-AI path for the mine.

**TURN/MATCH hooks are declared but near-vacuous for cozy's launch** (`isTurnComplete`, `resolveTurn`,
`projectMatchResult`, `applyMatchResult`, `onForfeit`, `viewFilter`): the cozy world is real-time, not
phase-gated. They are **still implemented** because (a) the CTK requires every module to be able to express a
Match, and (b) cozy *exercises* two of the Match primitives on purpose (synchronous trade escrow §4.m, and the
instanced-room lifecycle the farm/ranch/mine rooms already are) — PLATFORM.md Risk 3's "exercise the saga in
game #1" mitigation. `viewFilter` is used lightly for **co-op permission redaction** (a visitor who lacks co-op
grant does not receive interactable affordances), not hidden-info battle.

### 2.4 `RoomCaps` usage (the module's only handles into the world — PLATFORM.md §3.4)

| Cap | Cozy use |
|---|---|
| `store` | scoped CRUD on crop plots, inventory, animals, placed objects, relationships; engine syncs + persists-as-events |
| `ledger` | **the one value chokepoint** — crop/ore/product sales (faucet), seed/tool/building purchases (sink). Integer `COIN`. Module names reason codes only; can never write a posting or a `SYS_*` account (G5) |
| `custody` | animal/tool ownership transfer + the **escrow saga** for synchronous player-to-player trade (§4.m) |
| `cognition` | dispatch S1 villager decisions (gift reaction, daily schedule) + S2 dialogue; results arrive via `onDecision`/`onDialogueIntents`. **No `await` in `onTick`** |
| `memory` | `recall(session)` for villager memory of *this* player — engine injects session scope, never a player id (closes the cross-player leak in the handle) |
| `events` | append cozy-typed events; engine assigns `seq`/`prev_hash`/fence/actor, durable-before-ack (G4) |
| `clock` | **READ** authoritative event-sourced game-time (day, season, time-of-day). Module **cannot** advance it — "sleep skips the day" is resolved by the deterministic fast-forward (§5), not a `clock.advance()` |
| `timer` | deterministic, event-time per-instance timers: crop daily-growth ticks, animal product readiness, mine respawns, festival windows, ship-bin overnight settle |
| `match` | farm/ranch/mine-floor instances are server-created sessions; the synchronous-trade escrow + any future co-op minigame rides this |
| `rng` | the **only** randomness — weather rolls, forage placement, crop quality, loot tables, mine layout seed. Seeded from the current event so replay/fast-forward is byte-identical (G9) |
| `log` | low-cardinality telemetry |

---

## 3. Reuse map — what the cozy game gets for free

Celestia already ships most of what a cozy MMO needs. The table is the **first pass of the build economy**: reuse
as-is, extend, or build-new. (Exact symbols/paths for the ECS, Fornax, Pallas internals are threaded into §4.)

### 3.1 Engine mechanisms (reuse / extend)

| Engine piece | Path / package | What it is | Cozy reuse |
|---|---|---|---|
| **Caelum** | `packages/firmament/src/caelum/caelum.ts` | world/topology loader; boot-validates the graph (zones, maps, portals, mob roster, spawn tables) from JSON, Zod-validated | **Extend the exact pattern** (§8): add crop/item/recipe/villager/shop/calendar/fish/forage/animal/ore/floor manifests, boot-validated the same way. Dangling refs fail boot. |
| **ECS world + systems** | `services/atlas/src/ecs/world.ts`, `ecs/systems/*` | component storage + per-tick systems (e.g. `movement.system.ts`) | Reuse the world + tick; **add cozy systems** (crop-growth, animal, weather-apply, ore-respawn) and components (§4). Mob AI/movement systems reused by the mine. |
| **Orrery** (game loop) | `services/atlas/src` (NAMING lock) | movement, AoI/sectors, zone transitions, fixed-tick | Reuse for 20 Hz instanced rooms (farm/ranch/mine); the town uses a **slow** interval (§5). |
| **Fornax** (action pipeline) | `services/atlas/src/fornax/*` | `enumerate → allow → qualify → execute → event → signal`; `EventSink` with `seq`/`prev_hash` chaining; durable-before-ack | **Reuse wholesale** — every cozy action is new *data* plugged into the same stages (PIPELINE.md §4), never a new path. Combat already rides it; the mine inherits it. |
| **Astraea** (allow/qualify gates) | `services/atlas/src/...` (Fornax threads it) | the `allow()` access gate + `qualify()` state gate | Reuse; cozy supplies `resolveResource` typing + per-action authzClass + requirement sets. `game_id` scope (PLATFORM.md §6) baked into `ctx`. |
| **Pallas** (NPC decisions) | `services/atlas/src/pallas/*` | seeded-vector precedent decisions (MEMORY: never FSM/formulas, never a live model for basic behavior) | **Reuse for villagers AND the mine** — villager gift/schedule/topic decisions and mob combat AI both retrieve over seeded precedents. |
| **Monster roster + spawn tables + combat** | `content/mobs.json`, `content/zones/*/zone.json`, Fornax `attack` | roster = stats+sprite JSON; per-zone spawn tables; Pallas-driven AI; `attack` intent | **The mine REUSES all of it** (§4.l) — add mine monster kinds + per-floor spawn tables; **no new combat engine**. |
| **Themis** (enforcement) | `services/atlas/src/themis/*` | SessionRegistry (one-session/account, 4409 displacement) + revocation sweep | Reuse as-is (access, not game logic). |
| **Janus** (lobby) | `services/atlas/src` (NAMING lock) | badge auth · character select · zone entry (one access badge, seat reservation) | Reuse; cozy adds the **ranch/farm/mine room resolution** (join by ranch id) on top of the zone-entry seam (§6). |
| **ZoneRoom + placement persistence** | `services/atlas/src/rooms/ZoneRoom.ts`, `schema/ZoneState.ts` | Colyseus 20 Hz room: `onCreate/onJoin/onLeave/onMessage`, load/save `character_placement`, map broadcast, portals | Reuse as the base; **factor into the room-type set** (`town` persistent-pinned slow-tick vs `farm/ranch/mine` player-instanced — PLATFORM.md §4.1 `CelestiaRoom`→`Zone`/`Match`). |
| **norma** (wire contract) | `packages/norma/src/index.ts` | `PROTOCOL_VERSION`, intent types, shared constants, ticket claims, message shapes; shared `isWalkable`/`isBodyWalkable` | **Extend**: add cozy intent types + payload shapes (ids/indices only, G1). `InteractCommand{targetId}`/`AttackCommand{targetId}` are the exact precedent — cozy intents follow it. |
| **Pictor** (client render) | `packages/pictor/src/*` | framework-agnostic render orchestrator (RenderBackend port, id-diff, camera, HUD, VisualSpec) | Reuse; add cozy `VisualSpec`s (crop stages, villagers, animals, ore) + HUD (clock/season/wallet/energy) — §4.n. |
| **Jupiter** (client SDK) | `packages/jupiter/src/*` | transport/state/intents/contract (money-firewalled IntentSender) | Reuse; the cozy client sends indices/ids only. |
| **Firmament** (NestJS infra) | `packages/firmament/src/*` | Config (Zod) · Database (Kysely) · Tickets · Caelum | Reuse; new `mod_cozy` schema + migrations ride the Database module. **Runtime is `dist`** (MEMORY): rebuild firmament after editing. |
| **EconomyService / Moneta** | PLATFORM.md §4 (handle: `LedgerHandle`) | the single value chokepoint, integer money | Reuse via `caps.ledger`. Cozy declares currencies/reason codes; never writes a balance (G5). |
| **Event log / Akasha + replay** | PLATFORM.md §4 (`EventSink`) | append-only `log.event`, pure replay | Reuse; cozy event types + pure reducers. Offline fast-forward is replay-shaped (§5/§7). |

### 3.2 The content-driven pattern (the thing to copy for everything)

`content/mobs.json` + `caelum.ts` is the **canonical pattern** and the single most important thing to extend:

- **Roster = data, not code.** One JSON entry per *kind* (stats + client sprite key). Adding a kind = add JSON +
  reference it; **no code change**. (A monster is `{sprite, maxHp, damage, aggroRange, ...}`.)
- **Three-level placement.** Global roster (`content/mobs.json`) · per-zone placement/spawn table
  (`content/zones/<id>/zone.json`) · global sim defaults (`config/world.json` `respawn`). Cozy mirrors this for
  **every** system: crop roster + per-zone forage tables + global calendar defaults, etc. (§8).
- **Boot-validated graph.** Caelum Zod-parses and cross-checks references at boot (a spawn for an unknown kind, a
  portal to a missing spawn → **boot fails loudly**). Cozy manifests get the same treatment (a recipe referencing
  an unknown item, a shop selling an undeclared crop → boot fails).
- **Behavior is never a field.** `mobs.json` holds stats/sprite; what a mob *does* comes from **Pallas** seeded
  precedents (MEMORY: decisions from seeded vectors, not formulas). Villager behavior follows the same rule —
  schedules/reactions are Pallas precedents, not JSON `if`s.
- **Server sends `kind` + state; art is the client's.** The asset manifest maps `kind → sprite` opaquely (G3);
  the engine never learns what a "sprite" is. Cozy entity kinds (crop stages, villagers, animals, ore) ride this.

---

## 4. Gap analysis — what must be built

Each subsystem below is treated with the same template: **engine-primitive vs module responsibility** (PLATFORM.md
§2 + the a–g primitives of §2.1/§7.1), **content schema** (Caelum-validated JSON, mirroring `content/mobs.json`),
**ECS** components/systems (atop `services/atlas/src/ecs`), **intents** (norma, ids/indices only — G1),
**persistence / event-sourcing** (event types + `mod_cozy` tables), and **guardrail notes**.

Legend: **[E]** engine-primitive (`@celestia/*`, genre-neutral) · **[M]** module (`@celestia/game-cozy`).

### 4.0 Foundational engine gaps (build these first — they carry every system below)

The current code proves the mechanisms but **has not yet factored the engine from the game** (subagent finding:
ECS types, `ActionDef`s, and content live *inside* `services/atlas/src`, explicitly flagged to move to a
game-module package per G3 / PLATFORM.md §2). The cozy game is the forcing function to build PLATFORM.md's §7.1
"BAKE NOW" list. These are **engine** work, not cozy work, but cozy cannot exist cleanly without them:

| Gap | [E/M] | PLATFORM.md | What to build | Today |
|---|---|---|---|---|
| **`@celestia/game-contract`** (interfaces + leaf types) and **`@celestia/engine`** split | **[E]** | §3.1 | the `GameModule` interface, `ModuleRegistry`, `RoomCaps`, `WorldView`, `Resource`, `OptionSet`; dependency-cruiser arch-test (engine ↛ game-*) | none — one monolith |
| **Extract the Atlas game-content seam** into `@celestia/game-cozy` | **[E]+[M]** | §2 | move `ActionDef`s (lever/attack analogues), `MobState`/`Player` schema field *definitions*, `mob-situations.ts`, `content/player.ts` stats out of `services/atlas/src/{content,fornax/actions,ecs}` into the module; Atlas keeps the generic pipeline/ECS/room | content inside Atlas |
| **`CelestiaRoom` → `Zone` / `Match` factoring** + **per-room-type tick driver** | **[E]** | §4.1, §2.1 #3 | generalize `ZoneRoom` so tick is a room-type property (`{kind:'interval',hz}` incl. the **slow town hz**); add `player-instanced` + `ephemeral-match` lifecycles. `tickMs = round(1000/hz)` already exists per-zone; promote it to the room-type registry | one `ZoneRoom`, per-zone `tickHz` |
| **`ModuleRegistry.roomType/component/archetype/action/...`** wiring | **[E]** | §3.3 | the declare-at-mount registry the module fills; `main.ts` `gameServer.define` becomes `engine.mount(cfg.game.driver)` | hardcoded `define("zone"/"lobby")` |
| **`caps.timer`** — deterministic event-time per-instance timers | **[E]** | §3.4 | the timer wheel keyed to `ZoneState.t` (event-time, not wall-clock, G9); crop daily ticks, animal readiness, respawns, festival windows, ship-bin settle | none |
| **`caps.custody` + `escrowSwap` saga** | **[E]** | §4.3 | owned-asset transfer + two-phase escrow (the §4.m synchronous trade exercises it in game #1 — Risk 3 mitigation) | none |
| **`caps.ledger` / EconomyService (Moneta)** | **[E]** | §4, G5 | the double-entry integer-money chokepoint + `economy.posted@N`; cozy is its **first consumer** | none (no economy yet) |
| **`game_id` first-class in `allow()`** + `(account_id, game_id)` save key + `mod_cozy` schema | **[E]** | §6 | the cross-game isolation dimension; `mod_cozy.*` Postgres schema with its own GRANTs | one implicit game, no mod schema |
| **Player-instanced room lifecycle** (`joinOrCreate(ranchId)` + load/fast-forward/dispose) | **[E]** | §4.1, §5 | the lifecycle §6 needs; `reserveZoneSeat` + autosave already exist as seeds | zone rooms are singletons |

> **Sequencing note:** the §9 roadmap front-loads exactly these, but **right-sized** — the vertical slice needs
> only the tick-tier split, `caps.timer`, `caps.ledger`, player-instanced rooms, and `mod_cozy`; `custody`/escrow
> and the full `Match` phase-barrier can land with trading/co-op. Build what the committed cozy loops force
> (PLATFORM.md §7.1 "guiding cut"), not hypothetical game #3 generality.

### 4.a Time / calendar / seasons

- **Engine vs module.** **[E]** the **world clock**: an authoritative, event-sourced, slow-tick time source the
  module *reads* (`caps.clock`, no `advance()` — PLATFORM.md §3.4) + the slow Zone-level tick driver (§5). The
  world heartbeat is a documented-but-unbuilt seam (WORLDS.md §7). **[M]** what the time *means* — day length,
  4 seasons × N days, day-of-week, festival dates, "sleep advances to the next morning." **Proposed engine
  codename: Horologium** (the constellation "the Clock") for the world-clock/calendar-tick subsystem, if it
  warrants its own module; otherwise it is `Orrery`'s slow-tick mode + a cozy calendar reducer.
- **Content (Caelum JSON, `content/cozy/calendar.json`).**
  ```jsonc
  { "dayLengthSec": 1200, "daysPerSeason": 28,
    "seasons": ["spring","summer","fall","winter"],
    "festivals": [ { "id": "egg_festival", "season": "spring", "day": 13, "zoneId": "town_square" } ] }
  ```
- **ECS.** No per-entity component for time; a single **world-clock singleton** advanced by the town room's slow
  `onTick`. Synced to clients as `ZoneState` scalar fields (`gameDay`, `season`, `timeOfDay`) — the render HUD
  reads them (§4.n). Crop/animal growth **reads** game-day from the clock, never wall-clock (G9).
- **Intents (norma).** `sleep` (`{ }` — no args; at the farmhouse bed) → advances this instance's local day via
  the deterministic fast-forward (§5); `converse`/festival participation are separate intents. The client never
  sends a time value (G1).
- **Persistence / events.** `cozy.day_advanced@1 {day, season}`, `cozy.season_changed@1 {season}` into `log.event`;
  the clock's current value is a **projection of these events** (G4). `mod_cozy.world_clock(game_id, day, season,
  time_of_day, updated_seq)` is a snapshot/checkpoint of that projection.
- **Guardrails.** G9 (time is event-sourced + seeded, deterministic for fast-forward), G4 (day/season are events),
  G1 (no client-supplied time).

### 4.b Weather

- **Engine vs module.** **[E]** none specific — weather is pure module sim riding the world clock + `caps.rng`.
  **[M]** the weather model: a **deterministic function of (game-day, seed)** so a dormant farm reconstructs the
  same weather history on fast-forward (§5, G9). Rain auto-waters crops (a farming rule, §4.c).
- **Content (`content/cozy/weather.json`).**
  ```jsonc
  { "types": ["sunny","rain","storm","snow"],
    "seasonWeights": { "spring": { "sunny": 60, "rain": 35, "storm": 5 },
                       "winter": { "sunny": 40, "snow": 60 } } }
  ```
- **ECS.** `WeatherSystem` (town/world level) rolls the day's weather at day-advance via `caps.rng` seeded from the
  `cozy.day_advanced@1` event; result synced as a `ZoneState.weather` scalar. Instanced farms **recompute** the
  same roll for any historical day from (day, seed) — they never need the town to have been online.
- **Intents.** None — weather is autonomous world sim (G2: no client input).
- **Persistence / events.** `cozy.weather_rolled@1 {day, weather, seed}` logged at the world level; farms derive
  weather for a historical day by **replaying the same seeded function**, not by reading a per-farm row.
- **Guardrails.** G9 (seeded, wall-clock-free — the linchpin of offline reconstruction), G4.

### 4.c Farming — soil / crops / growth

- **Engine vs module.** **[E]** entity storage + sync (`store`), the tick driver, `caps.timer`, event log. **[M]**
  everything about soil and crops: tilling, planting legality, growth stages, watering, harvest yields, quality.
- **Content (`content/cozy/crops.json`** — the `mobs.json` analogue, roster keyed by crop id).
  ```jsonc
  { "crops": {
      "parsnip": { "sprite": "crop_parsnip", "seed": "parsnip_seed", "seasons": ["spring"],
                   "growthDays": 4, "stages": 5, "regrowDays": 0, "sellPrice": 35,
                   "produce": "parsnip", "waterPerDay": 1 },
      "blueberry": { "sprite": "crop_blueberry", "seed": "blueberry_seed", "seasons": ["summer"],
                     "growthDays": 13, "stages": 6, "regrowDays": 4, "sellPrice": 50, "produce": "blueberry" }
  } }
  ```
  Boot-validation (Caelum-extended): every `seed`/`produce` must resolve to `items.json`; `seasons` ⊆
  `calendar.json.seasons` — a dangling ref fails boot, exactly like a mob spawn for an unknown kind.
- **ECS.** New components on the farm room: `tilled{at}`, `crop{cropId, plantedDay, stage, wateredDay, watered}`;
  a **`CropGrowthSystem`** that, on each **game-day advance** (not every 20 Hz tick — gated by `caps.timer` keyed
  to event-time), advances `stage` toward ripe *iff* watered that day (or it rained — reads weather §4.b). On an
  instanced farm this system is run forward deterministically across the dormant gap (§5). Synced fields: a
  `CropTile extends Schema {id, x, y, cropId, stage, watered}` on `ZoneState` (parallel to `MobState`).
- **Intents (norma — ids/indices only, G1).**
  - `till {targetId}` — targetId = a soil tile id.
  - `plant {targetId, optionIndex}` — targetId = tilled tile; `optionIndex` selects from the server-**enumerated**
    plantable seeds in the player's inventory (NEVER a crop name/price from the client).
  - `water {targetId}`.
  - `harvest {targetId}` — server computes yield + quality via `caps.rng` (G1: client sends no amount).
- **Persistence / events.** `cozy.tilled@1`, `cozy.planted@1 {tileId, cropId, day}`, `cozy.watered@1`,
  `cozy.crop_grown@1 {tileId, stage}` (emitted by the growth system / fast-forward), `cozy.harvested@1 {tileId,
  produce, qty, quality}`. `mod_cozy` tables: `farm_plot(farm_id, tile_id, tilled, crop_id, planted_day,
  stage, watered_day)` — the mutable farm state loaded on room create. Crop growth during dormancy is
  reconstructed by replaying the seeded growth function from `lastSimTime` (§5), not stored per-idle-day.
- **Guardrails.** G1 (plant/harvest carry ids/indices, server computes yield), G9 (growth is a pure function of
  day + water-history + seed — survives fast-forward), G4 (plant/harvest are events), G6 (plant/water/harvest on a
  *visitor's* plot pass `allow()` with owner from authoritative state → deny unless co-op granted, §6/§10).

### 4.d Inventory & items

- **Engine vs module.** **[E]** generic `store` holds PER_PLAYER inventory entities; sync is per-player
  (hard-scoped — Bob can never read Alice's bag). **[M]** item *definitions*, stack/slot/weight rules (a module
  `validate()` rule, PLATFORM.md §2.1 #5 — **not** an engine primitive), categories (seed/crop/tool/ore/fish/
  forage/artisan/building-material).
- **Content (`content/cozy/items.json`).**
  ```jsonc
  { "items": {
      "parsnip":      { "sprite": "item_parsnip", "category": "crop",  "stack": 999, "baseSell": 35 },
      "parsnip_seed": { "sprite": "item_pseed",   "category": "seed",  "stack": 999 },
      "copper_ore":   { "sprite": "item_copper",  "category": "ore",   "stack": 999 },
      "watering_can": { "sprite": "item_can",     "category": "tool",  "stack": 1, "assetKind": "tool" } } }
  ```
- **ECS.** `inventory{slots: ItemStack[]}` as a PER_PLAYER component; not spatially synced. Tools that are
  tradeable reference an `assetKind` (so custody can transfer them, §4.m).
- **Intents.** `move_item {fromSlot, toSlot}`, `drop_item {slot}`, `use_item {slot, targetId?}` — all indices/ids;
  the server maps slot → item from authoritative state. Money is **never** an item field or an intent field (G1/G5).
- **Persistence / events.** Inventory mutations are events (`cozy.item_gained@1`, `cozy.item_consumed@1`) folded
  into the per-player inventory projection. `mod_cozy.inventory(character_id, slot, item_id, qty)`. Money lives in
  the **ledger**, never here (§4.f / G5).
- **Guardrails.** G1 (slot indices only), G5 (no money field — a `coins` item or a `price` arg is a finding),
  per-player hard-scope (PLATFORM.md §6).

### 4.e Crafting / recipes / stations

- **Engine vs module.** **[E]** `store`, `timer` (timed crafts like preserves/aging), event log. **[M]** recipes,
  stations, craft legality.
- **Content (`content/cozy/recipes.json`).**
  ```jsonc
  { "recipes": {
      "pickled_parsnip": { "station": "preserves_jar", "inputs": { "parsnip": 1 },
                           "output": { "item": "pickled_parsnip", "qty": 1 }, "craftDays": 3 },
      "copper_bar":      { "station": "furnace", "inputs": { "copper_ore": 5 },
                           "output": { "item": "copper_bar", "qty": 1 }, "craftDays": 1 } } }
  ```
  A station is a **placed object** (§4.h) whose `objectId` kind matches `recipe.station`. Boot-validate: every
  recipe input/output ∈ `items.json`, every station ∈ `objects.json`.
- **ECS.** `station{objectId, busyUntilDay, outputItem}` component on a placed object; a **`CraftingSystem`** that,
  via `caps.timer` keyed to game-day, completes timed crafts. Instant crafts complete in `execute`.
- **Intents.** `craft {stationId, recipeIndex}` — `recipeIndex` into the server-enumerated set of recipes this
  station can make *given the player's current inventory* (G1). The server consumes inputs + schedules/produces
  output; it computes nothing from the client.
- **Persistence / events.** `cozy.craft_started@1 {stationId, recipeId, readyDay}`, `cozy.crafted@1 {stationId,
  output, qty}`. `mod_cozy.crafting_job(station_id, recipe_id, ready_day)`.
- **Guardrails.** G1 (recipe index, server owns the recipe table + outputs), G6 (crafting at a visited farm's
  station passes `allow()` — owner-gated), G9 (timed completion keyed to event-time day, not wall-clock).

### 4.f EconomyService — selling / buying / markets

- **Engine vs module.** **[E]** the **one value chokepoint** (Moneta / `caps.ledger`): double-entry, integer
  money (`NUMERIC(38,0)`/`bigint`), idempotency, holds, the sole emitter of `economy.posted@N` (G5). **[M]**
  currency semantics (`COIN`, non-withdrawable), reason codes, and **all prices — computed in `execute`, never
  sent by the client** (G1).
- **Content (`content/cozy/economy.json`** — declared via `ModuleRegistry.economy()`).
  ```jsonc
  { "currencies": [ { "id": "COIN", "decimals": 0, "isToken": false } ],
    "reasonCodes": ["crop_sale","seed_purchase","tool_upgrade","ore_sale","product_sale","building_purchase"],
    "shops": { "pierre": { "zoneId": "town_square",
                 "buys": ["parsnip_seed","blueberry_seed"], "sells": ["parsnip","blueberry"] } },
    "faucets": { "crop_sale": { "dailyCap": null } },
    "priceModel": { "sell": "baseSell", "buyMarkup": 2.0 } }
  ```
  Market/price-fluctuation is a **module reducer** over day/season/supply (deterministic, seeded if random — G9),
  not an engine feature.
- **ECS.** No money component (G5). A **ship bin** is a placed object; overnight it **settles** via `caps.timer`
  at day-advance, posting `crop_sale` to the ledger. A town shop is a SHARED interactable keyed to a `shopId`.
- **Intents.** `buy {shopId, itemIndex, qtyIndex}` and `sell {shopId, slot, qtyIndex}` — all indices into
  server-enumerated options; `qtyIndex` selects a quantity bucket (1/5/all) the server defines, so **no raw
  amount crosses the wire** (G1). `ship {slot, qtyIndex}` drops into the bin. The server computes the price from
  the item's `baseSell` × the module price model and posts to the ledger.
- **Persistence / events.** The ledger emits `economy.posted@N` (engine, forever-compat per game — PLATFORM.md §6).
  Cozy emits `cozy.sold@1 {item, qty}` / `cozy.bought@1 {item, qty}` as game facts paired with the posting's
  idempotency key. Balances are a **projection of ledger postings**, never a stored row the module writes (G5).
- **Guardrails.** **G1** (indices/buckets only — a `price`/`amount` field is a money-printer regression), **G5**
  (every move via `caps.ledger`; the module can't name a `SYS_*` account), G9 (price model deterministic), G6
  (`spend_own` authzClass on buy/ship/sell).

### 4.g Ranch / farm instancing + custody

- **Engine vs module.** **[E]** the **player-instanced room lifecycle** (PLATFORM.md §4.1 `Match`-sibling /
  `player-instanced` room type): `joinOrCreate(ranchId)`, load persisted state, fast-forward, 20 Hz live tick,
  last-leaver persist + dispose (§6). **[E]** `custody` for **stateful owned assets** (animals, tools) distinct
  from inventory-as-items (PLATFORM.md §2.1 #2). **[M]** what a ranch *is* (its static map template is Caelum
  content; its mutable state is soil/crops/animals/objects), and the co-op permission policy (§10).
- **Content.** The ranch **map template** is static Caelum content (`content/zones/ranch_template/`), identical for
  every player; only the **mutable overlay** (plots/animals/objects) is per-ranch DB state. One template → N
  instances (PLATFORM.md ephemeral/persistent-instance primitive).
- **ECS.** The farm/ranch room runs `CropGrowthSystem`, `AnimalSystem`, `WeatherApplySystem`, plus the shared
  `MovementSystem`. Room identity = `ranchId` (the owner's character/farm id), set as room metadata and the
  `joinOrCreate` key.
- **Intents.** No new intent for *instancing* itself — it's a join-time resolution (§6). The in-ranch action
  intents are the farming/animal/building ones. `grant_coop {visitorId, scopeIndex}` and `revoke_coop {visitorId}`
  let an owner widen a visitor's `allow()` scope (§10).
- **Persistence / events.** `mod_cozy.ranch(ranch_id, owner_account_id, last_sim_time, checkpoint_seq,
  access_policy)` + the per-ranch `farm_plot`/`animal`/`placed_object` rows. Crash-safety = periodic checkpoint +
  event-log replay (§7). Custody transfers emit engine custody events; cozy animal/tool kinds carry a
  `stateSchema` (PLATFORM.md §3.3).
- **Guardrails.** G6 (owner/scope from authoritative `ranch.owner_account_id`, never the client), G9 (fast-forward
  deterministic), G4 (state is checkpoint + event replay), PLATFORM.md §6 (PER_PLAYER hard-scope on the save).

### 4.h Building / placement

- **Engine vs module.** **[E]** `store` for placed-object entities + spatial sync; `caps.timer` for construction
  that takes days. **[M]** the object catalog, placement legality (on your own land, on a buildable tile, not
  overlapping), and build costs.
- **Content (`content/cozy/objects.json`).**
  ```jsonc
  { "objects": {
      "preserves_jar": { "sprite": "obj_jar", "footprint": [1,1], "station": true, "cost": { "COIN": 50 } },
      "chicken_coop":  { "sprite": "obj_coop", "footprint": [3,2], "buildDays": 2,
                         "cost": { "COIN": 4000, "wood": 50 }, "houses": "chicken" },
      "fence":         { "sprite": "obj_fence", "footprint": [1,1], "cost": { "wood": 1 } } } }
  ```
- **ECS.** `placedObject{objectId, x, y, w, h, stateRef}`; a `PlacementSystem` validates footprint vs the map +
  other objects; a `ConstructionSystem` (timer-gated) completes multi-day builds. Synced as a `PlacedObject
  extends Schema` map on `ZoneState`.
- **Intents.** `place {objectIndex, tileId}` (objectIndex into inventory-held buildables), `move_object
  {objectId, tileId}`, `pickup {objectId}`. All ids/indices; the server validates placement + deducts cost via
  the ledger (G1/G5).
- **Persistence / events.** `cozy.object_placed@1 {objectId, kind, x, y}`, `cozy.object_removed@1`,
  `cozy.build_started@1 {kind, readyDay}`. `mod_cozy.placed_object(ranch_id, object_id, kind, x, y, state)`.
- **Guardrails.** G6 (place/move only where you own or are co-op-granted — authoritative scope), G1 (indices;
  server owns footprint + cost), G5 (build cost via ledger), G9 (timed build keyed to game-day).

### 4.i Villagers — Pallas behavior + friendship / gifting

- **Engine vs module.** **[E]** the whole Pallas spine (`services/atlas/src/pallas/*`): `Pallas` orchestrator,
  `DecisionFrame`, `decideFromPrecedent` (1-NN over seeded precedents ≥ `SIM_FLOOR`), `accept` (gates/rankings),
  `PrecedentStore`/`PgPrecedents`, `Mnemosyne` memory (per-player recall), and the S2 dialogue gateway slot
  (Mercury/Calliope). The engine owns mailbox/staleness and **re-authorizes the NPC as `actor=sim`** through the
  same gate (G2/G6, PLATFORM.md §3.6). **[M]** the **decision schemas + seeded precedents + perception encoder**
  (the `mob-situations.ts` analogue), friendship bands, gift tastes, dialogue persona/recall query.
- **Content.**
  - `content/cozy/villagers.json` — the roster (the `mobs.json` analogue):
    ```jsonc
    { "villagers": {
        "mira":   { "sprite": "npc_mira", "home": "mira_house", "schema": "npc_daily_schedule",
                    "giftTastes": { "love": ["blueberry"], "like": ["flower"], "hate": ["trash"] } } } }
    ```
  - `content/cozy/precedents/*.json` — authored situation→action precedents per decision schema, seeded into the
    `PrecedentStore` at boot via `pallas.seed(schema, rows)` (exactly like `MOB_TACTIC_SEED` for `"mob.tactic"`).
    Decision schemas: `npc_gift_reaction` (`allowedAnswers:["delighted","pleased","neutral","disliked"]`),
    `npc_daily_schedule` (`allowedAnswers` = authored waypoints), `npc_converse_topic`.
- **ECS.** `villager` archetype (SHARED, in the **town**): a synced `VillagerState` (position, current action
  label — mirroring `MobState.action` as a render hint) + a **server-only `brain`** component (never synced).
  Relationships are **PER_PLAYER**: a `relationship{villagerId, affection, giftsToday}` component hard-scoped so
  Alice's affection is physically unreadable by Bob (PLATFORM.md §6). A `VillagerScheduleSystem` dispatches
  `npc_daily_schedule` decisions off the hot path (fire-and-forget, like `MobAISystem`).
- **Intents.** `give_gift {targetId, slot}` (authzClass **interact_shared**; targetId=villager, slot=inventory
  slot — the server reads the item + looks up taste, computes the affection delta; client sends no value, G1),
  `converse {targetId}` (opens an S2 dialogue session; candidate intents from the model are re-validated, G2).
- **Persistence / events.** `cozy.gift_given@1 {villager, item}` + a sim-applied `cozy.affection_changed@1
  {villager, delta}` (the delta computed by the reducer after the Pallas reaction resolves — the PLATFORM.md §3.7
  `give_gift(mira, leek)` round-trip, verbatim). `mod_cozy.relationship(character_id, villager_id, affection,
  gifts_today, last_gift_day)`. Memory writes go through `caps.memory` (Mnemosyne), scoped by the engine.
- **Guardrails.** **G2** (Pallas returns an index into sim-authored options; the room re-enumerates + re-runs
  `allow()` before applying — the model never writes state, never mints affection), **G1** (gift carries a slot,
  not an affection number), G6 (interact_shared on a SHARED villager), per-player hard-scope on relationships.
  Behavior is **seeded precedents, not an FSM/formula** (MEMORY: decisions-from-seeded-vectors).

### 4.j Animals

- **Engine vs module.** **[E]** `store`, `caps.timer` (daily product readiness), `custody` (animals are a
  tradeable/portable `assetKind` — can be bought from a shop and later sold/gifted). **[M]** species, feeding,
  affection/mood, product tables, aging.
- **Content (`content/cozy/animals.json`).**
  ```jsonc
  { "animals": {
      "chicken": { "sprite": "animal_chicken", "house": "chicken_coop", "feed": "hay",
                   "product": "egg", "productDays": 1, "buyPrice": 800, "maxAffection": 1000 },
      "cow":     { "sprite": "animal_cow", "house": "barn", "feed": "hay",
                   "product": "milk", "productDays": 1, "buyPrice": 1500 } } }
  ```
- **ECS.** `animal{species, affection, fedDay, productReadyDay, age}` (PER_PLAYER, `scope:'dynamic'`); an
  `AnimalSystem` advances product readiness + applies fed/affection decay at day-advance (timer-gated, replayed
  across dormancy in the fast-forward). Pallas can drive simple animal wander/mood with a `animal_mood` decision
  schema reusing the mob-AI path.
- **Intents.** `buy_animal {shopId, animalIndex}` (ledger sink + `custody.claim` to the buyer), `feed
  {targetId, slot}`, `pet {targetId}` (affection+), `collect {targetId}` (gather the ready product into
  inventory). Ids/indices only; server computes affection + product qty (G1).
- **Persistence / events.** `cozy.animal_bought@1`, `cozy.animal_fed@1`, `cozy.animal_petted@1`,
  `cozy.product_collected@1 {animal, product, qty}`. `mod_cozy.animal(animal_id, ranch_id, species, affection,
  fed_day, product_ready_day, age)`. A sold/gifted animal transfers via `custody`/escrow (§4.m).
- **Guardrails.** G1, G6 (feed/collect on a visited ranch's animals — owner/co-op gated), G9 (readiness/decay are
  day-keyed deterministic functions for fast-forward), custody for ownership (PLATFORM.md §4.3).

### 4.k Fishing / foraging

- **Engine vs module.** **[E]** `caps.rng` (the only randomness, seeded — G9), `caps.timer`, the sealed-commit
  barrier **only if** a fishing minigame needs a hidden-then-revealed cast (it does not for launch — the result is
  server-computed). **[M]** fish/forage tables, water-tile legality, the minigame outcome model.
- **Content.**
  ```jsonc
  // content/cozy/fish.json
  { "fish": { "sardine": { "sprite": "fish_sardine", "seasons": ["spring","fall"], "water": "ocean",
                            "difficulty": 20, "sellPrice": 40 } } }
  // content/cozy/forage.json — seasonal wild spawns (a per-zone spawn table, like mobs in zone.json)
  { "forage": { "wild_horseradish": { "sprite": "forage_hr", "seasons": ["spring"], "sellPrice": 50 } } }
  ```
  Per-zone forage spawn tables live in each zone's `zone.json` `forage: [...]` block (mirroring the `mobs: [...]`
  spawn table), boot-validated against `forage.json`.
- **ECS.** A `ForageSystem` (seeded by `caps.rng` + the day) scatters forageables across zones at day-advance (the
  spawn-table mechanism reused from mobs). Fishing has no persistent entity — it's an action with a computed
  outcome.
- **Intents.** `fish {targetId}` (targetId = a water tile/spot; the server runs the seeded outcome and, if a
  skill-minigame is added, `fish_result {castIndex}` reports the client's timing as an **index into
  server-defined buckets**, never a raw score — G1). `forage {targetId}` (pick a spawned forageable into
  inventory).
- **Persistence / events.** `cozy.fished@1 {fish, quality}`, `cozy.foraged@1 {item}`. Forage spawns are
  **reconstructed from (day, seed)** on instanced rooms, not stored per-day.
- **Guardrails.** G1 (no client-supplied catch/score; buckets only), G9 (seeded spawns + outcomes), G2 (no model
  involvement in the core loop).

### 4.l The mine / dungeon (right-sized — mostly REUSE)

This is the loop that needs the **least new engine work** because combat already exists. Per the user decision:
descending floors, each an instanced room like a ranch; monster combat already built (Fornax); ore nodes are
harvestables on the crop gather path; loot → inventory/ledger; deeper ⇒ tougher + better. **Not a roguelike.**

- **Engine vs module.** **[E]** already-built: the monster roster + per-zone spawn tables (Caelum), Pallas mob AI
  (`MobAISystem`, `"mob.tactic"` schema, `MOB_TACTIC_SEED`, `decideFromPrecedent`/`accept`), the Fornax combat
  pipeline (`attackAction`, server-computed `damage`, `ENTITY_DAMAGED`/`ENTITY_KILLED` signals — **the same action
  reused for player and mob, G2**), A* `pathfind`, respawn lifecycle, `caps.timer`. **[E] new:** the
  player-instanced room lifecycle (shared with ranches, §4.g) applied per floor. **[M]** floor content, mine
  monster kinds, ore nodes, loot tables, descent rules. **Proposed engine/module codename for the descent/floor
  manager: Erebus** (primordial darkness/the underworld shaft) — but it is mostly a **room-type + content**, not a
  new engine service.
- **Content.**
  - `content/mobs.json` — **extend** with mine monsters (`slime`, `bat`, `rock_crab`), reusing the exact existing
    stat schema (`maxHp`, `damage`, `aggroRange`, `attackRange`, `attackCooldownMs`, `decisionIntervalMs`,
    `respawnDelayMs`). **No code change** to add a monster.
  - `content/cozy/ore.json` — ore-node roster (a harvestable, the crop analogue):
    ```jsonc
    { "ore": { "copper_node": { "sprite": "node_copper", "hp": 3, "drops": { "copper_ore": [1,3] },
                                "respawnDays": 1, "minFloor": 1 } } }
    ```
  - `content/cozy/mine.json` — floor manifest + per-floor spawn/loot tables (recommend **authored floor templates
    first**, lightly-procedural later — simpler to ship and to make deterministic for replay):
    ```jsonc
    { "floors": { "count": 120,
        "tiers": [ { "from": 1,  "to": 39,  "monsters": ["slime","bat"],       "ore": ["copper_node"] },
                   { "from": 40, "to": 79,  "monsters": ["rock_crab","skeleton"], "ore": ["iron_node"] } ],
        "ladderChance": 0.2, "layout": "authored" } }
    ```
  - Each floor is a **zone template** (`content/zones/mine_f<tier>/`) reusing the existing `zone.json` `mobs`
    spawn-table block + a new `ore` block (boot-validated against `ore.json` just like mobs).
- **ECS.** Reuse `MovementSystem` + `MobAISystem` unchanged. New `oreNode{kind, hp}` component + a `MiningSystem`
  / treat it as a harvestable in `execute` (ore is struck with the pickaxe tool → drops into inventory via the
  same gather path as `harvest`). `MobState` schema already carries hp/level/action.
- **Intents.** `attack {targetId}` — **the existing intent, reused verbatim** (norma already has it). `mine_node
  {targetId}` (pickaxe a node → server computes drops via `caps.rng` + loot table). `descend {targetId}` (take a
  ladder/shaft to floor N+1 → a seat reservation into the next floor's instanced room, exactly the portal/zone-
  transfer mechanic in `ZoneRoom.checkPortals` + `reserveZoneSeat`). `use_item {slot}` (consumables). All ids/
  indices; damage + drops are server-computed (G1).
- **Persistence / events.** `cozy.ore_mined@1 {node, drops}`, `cozy.floor_descended@1 {fromFloor, toFloor}`,
  plus the existing combat events. Mine floors are **ephemeral instanced rooms**: their transient combat state is
  rebuildable by replaying the floor's event stream (PLATFORM.md §4.2 — "ephemeral" = process, not stream); only
  durable results (inventory gains, deepest-floor-reached progression) persist to `mod_cozy.mine_progress
  (character_id, deepest_floor)` + the ledger/inventory. A floor's **layout seed** is derived deterministically
  so a reconnect rebuilds the same floor (G9).
- **Guardrails.** G1 (attack/mine carry target ids; server computes damage/drops), G2 (mob AI re-enters the same
  pipeline as a re-validated `actor=sim`), G4/G9 (combat turns + drops are seeded, event-sourced, replayable —
  free anti-cheat, PLATFORM.md §4.2), G5 (ore/loot sale via the ledger).

### 4.m Social / trading / visiting

- **Engine vs module.** **[E]** the **visiting** mechanism = the player-instanced room `joinOrCreate(ranchId)`
  with an access-policy check at join (§6); **[E]** the **custody + `escrowSwap` saga** for synchronous
  hand-to-hand item/animal trade (PLATFORM.md §4.3) — cozy is the **chosen game-#1 exercise of the escrow path**
  (PLATFORM.md Risk 3 / Open decision 2: ship a real cozy synchronous trade to exercise the saga). **[M]** the
  co-op permission policy (what a visitor may do), gift/mail, (later) festivals/marriage.
- **Content.** `content/cozy/social.json` — co-op scope presets (`look_only`, `water_harvest`, `full_coop`)
  mapping to the `allow()` scopes an owner can grant. Access policy values: `private | friends | public`.
- **ECS.** Visiting adds no entity — it's room membership. Trade uses a transient **escrow entity** owned by the
  engine saga, not a module component.
- **Intents.** `grant_coop {visitorId, scopeIndex}` / `revoke_coop {visitorId}` (owner-only, §10). `trade_offer
  {toCharacterId}`, `trade_set {slotIndices}`, `trade_confirm {}`, `trade_cancel {}` — the two-phase barrier:
  both parties `trade_confirm` before `COMMIT`; either `trade_cancel` → `ABORT` releases all legs (PLATFORM.md
  §4.3). Items/animals only; **no money leg at launch is required**, but a COIN leg rides the same ledger-hold if
  added. All ids/indices (G1).
- **Persistence / events.** The escrow saga is an engine outbox state machine persisted in `log.event`
  (`PREPARE`/`COMMIT`/`ABORT`, idempotent fenced legs). Cozy emits `cozy.gift_mailed@1` for async gifting.
  `mod_cozy.friendship(account_a, account_b, status)` for the social graph (or reuse a platform social seam).
- **Guardrails.** **G6** (enter-policy at join + per-action `allow()` for a visitor; owner/scope from authoritative
  state — default look-but-don't-touch), **G5 + custody** (every value move via the two chokepoints + one escrow
  saga, no third path), G4 (saga is event-sourced + crash-resumable), G1 (trade carries slot indices only).

### 4.n Client / HUD (Pictor)

- **Engine vs module.** **[E]** Pictor (`@celestia/pictor`) — the framework-agnostic render orchestrator
  (RenderBackend port, id-diff, camera, HUD scaffold, per-entity `VisualSpec`), plus Jupiter (SDK) with its
  **money-firewalled IntentSender** (structurally refuses `amount`/`price` fields — G1). **[M]** the cozy
  `VisualSpec`s + HUD widgets + input→intent mapping (the Godot render package / the `pyxis`/`phaethon` web
  backends during the POC).
- **What the module supplies.** `VisualSpec`s for crop stages (sprite per `growthStage`), villagers, animals, ore
  nodes, placed objects; a HUD showing **clock/day/season/weather** (from `ZoneState` scalars, §4.a/§4.b),
  **wallet** (COIN, read from a server-pushed per-player balance projection — the client never computes it, G1),
  energy/health, inventory/toolbar, and the dialogue panel for S2 villager lines (`dialogue.token` stream).
- **Input → intent.** Tool-on-tile → `till`/`water`/`plant`; click villager → `converse`/`give_gift`; click node
  → `mine_node`; click monster → `attack` (reused). The client sends `{target, optionIndex}` only (indices/ids).
  Asset mapping (`kind → sprite`) rides the existing opaque `AssetManifest` (norma) — the engine never interprets
  art (G3).
- **Persistence / events.** None (client is a dumb renderer). Per-seat redaction: a visitor lacking co-op grant
  receives no interactable affordances (the light `viewFilter` use, §2.3).
- **Guardrails.** G1/G11 (client sends indices/ids, never amounts or privilege; IntentSender enforces it), G3
  (art/render is module+client only; engine ferries `kind` opaquely).

---

## 5. Offline progression + the per-room-type tick model

This is **PLATFORM.md's per-room-type tick driver** (§2.1 #3), made concrete for cozy. Two tiers, one engine:

| Tier | Room-type | Tick | What it simulates | Lifecycle |
|---|---|---|---|---|
| **World / city** | `town` (SHARED, persistent-pinned) | **slow interval ~1 Hz** (`{kind:'interval', hz:1}`) | calendar, seasons, weather roll, festivals, global events, villager schedules (dispatch) | always up (WORLDS.md §7 world heartbeat) |
| **Farm / ranch / mine floor** | `farm`/`ranch`/`mine_floor` (PER_PLAYER, player-instanced) | **20 Hz** (`{kind:'interval', hz:20}`) | real-time movement, farming/animal/combat actions, live crop/animal advance for the current instant | spun up on first visit, disposed on last leave |

> **Vocabulary (user's "cluster"):** the fast instanced room the user informally calls a "cluster" **is a
> `player-instanced` room instance** (a Channel/room in WORLDS.md §7 terms). Use "instanced room"; "cluster = an
> instanced room" is the most we note. The town is a Zone running a slow tick — not a separate concept.

The engine already computes a per-room integer timestep (`tickMs = round(1000/tickHz)` in `ZoneRoom.onCreate`);
the only change is to make `hz` a **room-type property** (incl. the slow town value) and add the two instanced
lifecycles. The slow town hz is a config value (G8/no bare literal — it lives in `calendar.json`/room-type decl).

### 5.1 Offline progression = lazy compute-on-load fast-forward (decision 3)

Dormant farms are **not simulated** — they are **DB rows** (§6). When the farm is next loaded (owner or visitor
triggers it), the engine reconstructs the dormant gap **deterministically**:

```
onRoomCreate(ranchId):
  1. load mutable state + lastSimTime + checkpoint_seq  from mod_cozy  (§4.g)
  2. gap = now(gameClock) − lastSimTime                               // in game-days
  3. for each elapsed game-day d in the gap, in order:
       weather(d)      = seededWeather(d, worldSeed)                  // §4.b — pure (G9)
       advance crops   via CropGrowthSystem for day d (watered? rained?)  // §4.c
       advance animals via AnimalSystem for day d                     // §4.j
       re-roll forage/ore respawns via caps.rng seeded from d         // §4.k/§4.l
  4. stamp lastSimTime = now; tick live at 20 Hz
```

**Why it reconstructs identically regardless of who triggers it (the invariant that makes this safe):** every
advance is a **pure function of (game-day, world-seed, the farm's own prior state)** — no `Date.now()`, no live
RNG, no reads of other players (G9). So visitor-triggered load == owner-triggered load == a crash-replay, byte for
byte. This is the same determinism the event log already relies on (G4); the fast-forward is **replay-shaped**.

**The one residual (PLATFORM.md Open decision 7):** "private-farm-ahead-of-town-time." If a player sleeps on their
farm (advancing *their* instance's local day) while the shared town clock is authoritative, the two can diverge.
Resolution: the **town world-clock is authoritative**; the farm fast-forward is always computed *relative to the
authoritative game-day*, and `sleep` advances by resolving against it (never a free-running per-farm clock). Accept
a small reconciliation-on-enter as an MMO tax, or design the UX — flagged in §11.

### 5.2 Why not continuous idle simulation

Simulating every dormant farm at 1 Hz would make concurrent-online == total-players (ruinous CPU). The
compute-on-load model makes **total players = storage** and **concurrent-online = rooms/CPU**, so Atlas scales out
across nodes by sharding instanced rooms (§6). The cost is a one-time fast-forward on load (bounded by the gap);
mitigate long gaps with periodic checkpoints (§7) so the replay starts from the last checkpoint, not day zero.

---

## 6. Instancing & topology (decision 2)

Mapped onto WORLDS.md (World→Zone→Channel→Sector) and PLATFORM.md (§4.1 room factoring, §6 scoping):

```
Account ── (account_id, game_id='cozy')               PLATFORM-GLOBAL identity + per-game save
  └─ World "celestia" (single, shared)                WORLDS.md IDEAL row; world_id seam reserved
       ├─ Zone "town_square" (SHARED, persistent)     slow ~1 Hz; everyone shares it; villagers live here
       ├─ Zone "ranch:<ownerId>" (PER_PLAYER)          INSTANCED 20 Hz room, keyed by ranch/owner id
       │     • joinOrCreate(ranchId): 1st entrant creates → load+fast-forward → live
       │     • others join the SAME instance; last leaver persists + disposes
       └─ Zone "mine:<characterId>:f<N>" (instanced)   INSTANCED 20 Hz floor, keyed per descent
```

### 6.1 Ranch instancing (the core decision, verbatim)

- **Room identity = ranch/owner id.** `joinOrCreate(ranchId)` — the existing `reserveZoneSeat` + Janus zone-entry
  seam resolves which room (new: the key is a ranch id, not a static zone id).
- **First entrant (owner OR visitor) creates the room** → loads the ranch's **persisted mutable state** from
  `mod_cozy` (soil/crops/animals/placed objects + `lastSimTime`; the map template is static Caelum content) →
  **fast-forwards the dormant gap deterministically** (§5.1) → ticks live at 20 Hz.
- **Others join the same instance** (co-op visit). Access gated by policy at join (§6.3).
- **Last to leave** → persist state + stamp `lastSimTime` → Colyseus disposes the room.
- **Dormant ranches are NOT rooms** — just DB rows. Total players = storage; concurrent-online = rooms/CPU; scale
  out across Atlas nodes (Colyseus multi-process + the Channels seam, WORLDS.md §7 / REALTIME §10).

This **is** PLATFORM.md's ephemeral/persistent-instance primitive + custody primitive, applied to a life-sim — the
named second consumer that keeps the `Match`/instanced-room factoring from being Pokémon-specific (PLATFORM.md
§4.1). Mine floors are the same lifecycle, keyed per descent.

### 6.2 Topology mapping (no new vocabulary)

| User / cozy word | WORLDS.md / PLATFORM.md term |
|---|---|
| "cluster" (fast instanced room) | a **room instance** of a `player-instanced` room-type (a Channel) |
| town / city | a **Zone** (SHARED, persistent-pinned) on the slow tick |
| a visited farm | a **room instance** keyed by `ranchId` |
| a mine floor | a **room instance** keyed by `(characterId, floorN)` |
| "which nearby entities do I see" | **Sector** / AoI (a spatial index inside the room — not a room) |

### 6.3 Who may ENTER vs who may DO (the permission split, decision 4)

- **ENTER = access policy at join** (`private | friends | public`), checked when resolving the `joinOrCreate`
  seat. This is a *join gate*, not `allow()` on an action.
- **DO = `allow()` deny-by-default per action** (G6): a visitor's `plant`/`water`/`harvest`/`pickup` on the
  owner's plots passes `allow()` with `resolveResource` reading `ranch.owner_account_id` from **authoritative
  state**, never the client. Default = **look-but-don't-touch**; `grant_coop` widens the visitor's scope (§4.m).
- These are **orthogonal**: a public farm anyone may enter still denies touching unless co-op is granted.

---

## 7. Persistence model (event-sourced + checkpointed)

Celestia is event-sourced (G4): mutations are append-only events in `log.event` with a `seq` + `prev_hash` chain
(the existing `fornax/event-chain.ts`: `hashEvent`/`nextRow`/`verifyChain`, one stream per room; `DurableEventSink`
persists them durable-before-ack). Cozy inherits this wholesale. The model has **three layers**:

1. **Durable event log (truth).** Every cozy mutation is a `cozy.*@1` event appended through `caps.events`. The
   engine stamps `seq`/`prev_hash`/fence/actor; the module supplies only the PII-free payload. Economy moves emit
   the engine's `economy.posted@N`. This is the forever-compat surface (PLATFORM.md §6) — replay must support
   every historical `@version`; schema bumps are additive.
2. **Materialized projection (`mod_cozy.*` tables).** The queryable, load-on-room-create state: `ranch`,
   `farm_plot`, `inventory`, `animal`, `placed_object`, `crafting_job`, `relationship`, `mine_progress`,
   `world_clock`, `friendship`. These are a **projection of the event log via pure reducers**, not independent
   truth (G4 — no mutable row is the source of truth). They exist for fast load + fast-forward input.
3. **Checkpoints (snapshot to bound replay).** Each instanced farm/ranch periodically (and on last-leave) writes a
   checkpoint = `{state snapshot, lastSimTime, checkpoint_seq}`. Crash recovery / dormant-load = **replay events
   after `checkpoint_seq`** onto the checkpoint, then the §5.1 fast-forward for any game-days beyond `lastSimTime`.
   This keeps the fast-forward bounded even for a farm dormant for a long real-time gap.

### 7.1 Event-sourced vs snapshot — which for what

| Data | Model | Why |
|---|---|---|
| farming actions, gifts, crafts, mining, economy | **event-sourced** (`cozy.*@1` + `economy.posted@N`) | durable truth; replay/audit; deterministic (G4/G9) |
| farm mutable overlay (plots/animals/objects) | **projection + periodic checkpoint** | fast load; bounded fast-forward; rebuildable from events |
| crop growth / weather / forage during dormancy | **computed, not stored** | pure function of (day, seed) — §5.1 (G9); storing per-idle-day is wasteful and non-authoritative |
| mine floor transient combat state | **event stream only (ephemeral room)** | PLATFORM.md §4.2 — "ephemeral" = process, not stream; reconnect replays the floor's turns |
| money / balances | **ledger postings only** (Moneta) | G5 — balance is a projection of postings, never a module-written row |
| character identity + placement | **engine tables** (`game_character`, `character_placement`) | CHARACTERS.md — engine-owned, genre-neutral |

### 7.2 GRANT discipline + schema

`mod_cozy` is its own Postgres schema with its own least-privilege GRANTs (PLATFORM.md §3.2 / PIPELINE.md §3
one-writer-per-table). Atlas (the cozy module host) writes `mod_cozy.*` + `log.event`; it has **no** write grant
on `account`/`auth` (Polaris's lane) — the help-desk/game split holds. `(account_id, game_id)` composite-keys
every per-player row (PLATFORM.md §6), so the multi-game seam is additive.

---

## 8. Content pipeline (Caelum-validated JSON)

Every new system is **data-driven through the `content/mobs.json` + `caelum.ts` pattern** (§3.2), registered via
`ModuleRegistry.content(manifest)` and boot-validated (Zod + cross-reference checks) so a dangling reference fails
boot loudly — exactly as a spawn for an unknown monster kind does today. **Adding content = editing JSON, not
code.**

### 8.1 The file layout (three levels, mirroring the mob pattern)

| Level | Pattern today (mobs) | Cozy files |
|---|---|---|
| **Global roster** (kind → stats + sprite) | `content/mobs.json` | `content/cozy/{crops,items,recipes,objects,villagers,animals,fish,forage,ore}.json`; mine monsters **extend** `content/mobs.json` |
| **Per-zone placement / spawn table** | `content/zones/<id>/zone.json` `mobs:[...]` | add `forage:[...]`, `ore:[...]`, shop placements; `content/zones/{town_square,ranch_template,mine_f*}/` |
| **Global sim defaults** | `config/world.json` `respawn` | `content/cozy/{calendar,weather,economy,social,mine}.json` (season length, weather weights, price model, co-op presets, floor tiers) |

### 8.2 Boot-validation extensions (Caelum, same loud-fail discipline)

- every crop `seed`/`produce`, recipe input/output, shop buy/sell list, animal `feed`/`product`, building `cost`
  material → must resolve to `items.json`;
- every crop/fish/forage `seasons` ⊆ `calendar.json.seasons`;
- every recipe `station` ∈ `objects.json`; every animal `house` ∈ `objects.json`;
- every villager `schema` has seeded precedents; every `giftTastes` item ∈ `items.json`;
- every mine tier `monsters` ∈ `mobs.json` and `ore` ∈ `ore.json`; every floor template's spawn table resolves;
- every economy `reasonCode` used in `execute` is declared.

A failure here is a boot failure (never a silent runtime surprise) — the invariant Caelum already enforces.

### 8.3 Example shapes

Full example shapes are inline in §4 (crops §4.c, items §4.d, recipes §4.e, economy §4.f, objects §4.h, villagers
+ precedents §4.i, animals §4.j, fish/forage §4.k, ore + mine §4.l, calendar/weather §4.a/§4.b). They deliberately
mirror `content/mobs.json`: a flat map keyed by the thing's id, values = `{sprite, ...gameplay stats}`, **behavior
never a field** (villager/animal behavior comes from Pallas seeded precedents, not JSON `if`s). The `sprite` is a
client asset key the engine carries opaquely (G3); the server sends `kind` + state on the wire, never art.

---

## 9. Phased roadmap — seams before content, prove before build

Ordered by dependency. **De-risk the unknowns first** (tick-tier split, instanced-room lifecycle, deterministic
fast-forward, event-sourced economy), lay the ruinous-to-retrofit seams into the skeleton, *then* pour content.
Each phase has a definition-of-done (DoD). PLATFORM.md's game-#1 primitives are scheduled explicitly (§9.2).

### 9.1 Phases

**Phase 0 — Engine seams (the §4.0 foundation, right-sized to the slice).** *Engine work.*
- `@celestia/game-contract` + `@celestia/engine` split; `GameModule`/`ModuleRegistry`/`RoomCaps` interfaces;
  dependency-cruiser arch-test (engine ↛ game-*, G3). Extract the Atlas content seam into `@celestia/game-cozy`
  (move `ActionDef`s, schema field defs, `mob-situations.ts`, `content/player.ts`).
- Room-type tick driver: `hz` as a room-type property incl. the **slow town** value; keep `tickMs=round(1000/hz)`.
- Player-instanced room lifecycle (`joinOrCreate(ranchId)` + load/dispose), reusing `reserveZoneSeat`/autosave.
- `caps.timer` (event-time), `caps.ledger`/Moneta (EconomyService, cozy = first consumer), `game_id` in `allow()`,
  `mod_cozy` schema + migration, `(account_id, game_id)` save key.
- **DoD:** CTK green (every mutating intent routes `allow()` before execute; `resolveResource` from state;
  `game_id` enforced; every event has a pure reducer; fungible value only via ledger). A trivial module mounts via
  `engine.mount('cozy')`; town room ticks at ~1 Hz, an instanced room at 20 Hz; arch-test red on an engine→game edge.

**Phase 1 — Vertical slice (de-risked, fully server-authoritative). THE PROOF.**
- World clock + minimal calendar (day advance, one season). ONE crop (parsnip): `till → plant → water →
  (day advances) → harvest → inventory → sell`. Ranch instancing (`joinOrCreate` your own farm) + persistence
  (checkpoint + `mod_cozy` projection) + **deterministic fast-forward** across a dormant gap. `sell` posts COIN to
  the ledger. All via Fornax (enumerate→allow→qualify→execute→event→signal); client sends indices/ids only.
- **DoD:** a headless `scripts/smoke.ts`-style test does login → enter ranch → till/plant/water → advance N days →
  harvest the correct yield → sell → COIN balance correct; **log off, advance the clock, re-enter → crops grew the
  identical amount** (fast-forward == live, byte-identical); replay of the event log reproduces the final state
  (G4/G9). No client-sent number anywhere (G1 grep clean).

**Phase 2 — Farming breadth.** Multiple crops; 4 seasons + calendar; weather (seeded, auto-waters); watering/soil;
regrow crops; crop quality; shops breadth; ship-bin overnight settle. **DoD:** a full season of multi-crop farming
sells correctly; weather history reconstructs on fast-forward identically.

**Phase 3 — Villagers + cognition.** Villager roster + schedules (Pallas `npc_daily_schedule` precedents in the
town); gifting + friendship bands (`give_gift` → Pallas `npc_gift_reaction` → affection, the §3.7 round-trip); S2
dialogue (Calliope) when the model is wired (precedent-only until then — MEMORY). **DoD:** gifting a loved item
raises only the giver's PER_PLAYER affection; a cross-player read is physically impossible; behavior comes from
seeded precedents (no FSM).

**Phase 4 — Animals, building, crafting.** Animals (buy via custody, feed/pet/collect, timer-gated products);
building/placement (footprint validation, multi-day builds); crafting stations + recipes (timed crafts).
**DoD:** place a coop, buy a chicken, feed daily, collect eggs across a dormant gap; craft a timed good.

**Phase 5 — The mine (reuse combat).** Extend `content/mobs.json` with mine monsters; ore nodes (harvestable);
`descend` (instanced floor per descent, portal/seat-reservation mechanic); loot tables → inventory/ledger;
deeper ⇒ tougher + better. **Reuses Fornax `attack`, `MobAISystem`, A*, respawn — no new combat engine.**
**DoD:** descend floors, fight reused monsters, mine ore, bank loot; a mid-floor reconnect replays the floor;
combat drops are seeded + event-sourced.

**Phase 6 — Social / co-op / trade (exercise the escrow saga).** Visiting (enter-policy at join); co-op grants
(`allow()` scope widening); **synchronous player-to-player trade via `custody` + `escrowSwap`** — the deliberate
game-#1 exercise of the escrow path (PLATFORM.md Risk 3 / Open decision 2) with a CI property-test harness over
concurrent trade/checkout interleavings; async gift-mail. (Festivals/marriage later.) **DoD:** two players trade
items atomically (both confirm → commit; either cancel → all legs release); no dupe under randomized
interleavings; a visitor cannot touch un-granted plots (G6).

### 9.2 PLATFORM.md game-#1 primitives — scheduled, not deferred

| Primitive (PLATFORM.md §2.1/§7.1) | Phase | Cozy consumer that forces it |
|---|---|---|
| (a) per-room-type tick driver + per-instance timer | **P0** | slow town vs 20 Hz farm; crop/animal day-ticks |
| (e) ephemeral/`player-instanced` room vs pinned | **P0/P1** | ranch/farm/mine instancing |
| (g) `game_id` first-class in `allow()` | **P0** | the module boundary + cross-game isolation |
| EconomyService (`caps.ledger`) | **P0/P1** | sell crops / buy seeds |
| `caps.custody` + (f) escrow saga | **P6** | synchronous item/animal trade (Risk 3 exercise) |
| (b) sealed-commit turn barrier | **P6** | two-party trade confirm (its one cozy use; not generalized) |
| (c) per-seat `viewFilter` | **P6** | co-op affordance redaction for un-granted visitors |
| (d) custody of stateful owned assets | **P4/P6** | animals/tools as tradeable asset kinds |

**Guiding cut (PLATFORM.md §7.1):** build what the committed cozy loops force; refuse generality whose only
customer is a hypothetical game #3. The `Match` barrier ships for trade in its minimal form (not generalized to
auctions); `viewFilter` is used for co-op redaction (not hidden-info battle).

---

## 10. Guardrail compliance

| G | Rule | How the cozy plan complies |
|---|---|---|
| **G1** | client never trusted; intents carry indices/ids, never amounts/prices/state | Every cozy intent is `{target/ids, optionIndex/qtyIndex}` (§4). The server `enumerate()`s legal options and **computes every number** — yield, price, damage, affection, drops. Jupiter's IntentSender structurally refuses `amount`/`price` fields. `buy`/`sell` use server-defined quantity **buckets**, never a raw amount. A `price`/`amount`/`qty` numeric field on any cozy intent is a finding. |
| **G2** | the LLM never writes state | Pallas returns an **index** into a sim-authored `allowedAnswers` set (`npc_gift_reaction`, `npc_daily_schedule`); the room re-`enumerate`s + re-runs `allow()` as `actor=sim` before applying (PLATFORM.md §3.6, verbatim §3.7). Cognition holds **zero** grant on `ledger.*`/`custody.*`. S2 dialogue candidate-intents are re-validated. Behavior = seeded precedents, never a live-model grant (MEMORY). |
| **G3** | engine ↛ game module | `@celestia/game-cozy` imports the engine; the engine **never** imports it. Dependency-cruiser arch-test is red on any engine→game edge (§9 P0). Art/`sprite` keys ride the opaque `AssetManifest` — the engine never interprets them. The Atlas content seam is **extracted into the module**, not left in the engine. |
| **G5** | one EconomyService chokepoint, integer money | All value moves via `caps.ledger` (COIN, `decimals:0`, `bigint`/`NUMERIC(38,0)`); the module declares reason codes only and can never write a posting or name a `SYS_*` account. Balances are a projection of postings — **no money component, no money column in `mod_cozy`** (§4.d/§4.f). Trade spanning items+money rides the one escrow saga (§4.m). |
| **G6** | `allow()` deny-by-default before enumerate/execute | Every mutating cozy action passes `allow(actor, authzClass, resource, ctx)` first; `resolveResource` reads owner/scope from authoritative state (`ranch.owner_account_id`, villager SHARED scope), **never** the client envelope. Visitor actions default-deny (look-but-don't-touch) until `grant_coop` (§6.3). `ctx.gameId='cozy'` denies any foreign-game resource. |
| **G9** | determinism; seeded RNG; no wall-clock in sim | Crop/animal growth, weather, forage/ore spawns, loot, crop quality are **pure functions of (game-day, seed, prior state)** via `caps.rng` + `caps.clock` — no `Date.now()`, no live RNG (the linchpin of the offline fast-forward §5.1 and event replay §7). Timers key to event-time (`ZoneState.t`), not wall-clock. |
| **G10** | naming/structure; celestial codenames | `services/` not `apps/`; no `-server` suffix. The module is `@celestia/game-cozy` (PLATFORM-fixed) with codename **Ceres**; new engine subsystems proposed as **Horologium** (world clock) / **Erebus** (mine descent) from NAMING.md. Wire constants live in `@celestia/norma` (never hand-typed twice). |
| **G11** | client never sets its own privilege | Identity/role arrive on the Polaris-signed access badge (`ZoneSeatAuth` → `client.auth`), never a client claim; `onAuth` is skipped for a reserved seat so the client cannot assert identity. Co-op grants are written by the **owner** through an audited `grant_coop` action gated by `allow()` reading authoritative ownership — never a client-asserted scope. Access policy (enter) is server-enforced regardless of what the client renders. |

**G4 (event-sourced truth)** and **G7 (ports/adapters)** / **G8 (no secrets)** also hold: cozy mutations are
append-only `cozy.*@1` events with pure reducers (§7); concrete adapters (`DurableEventSink`, `PgPrecedents`,
ledger) are named only at the composition root (the subagent confirmed this is already the pattern in `main.ts`);
all tunables (season length, tick hz, prices, caps) come from Caelum content/config, never inline literals.

---

## 11. Open questions / decisions needed

1. **Private-farm-vs-town clock divergence (PLATFORM.md Open #7).** `sleep` advances a farm instance's local day;
   the shared town clock is authoritative. Confirm: always fast-forward relative to the authoritative game-day
   (recommended), and decide the reconciliation UX vs accept it as an MMO tax (§5.1).
2. **Escrow exercise scope (PLATFORM.md Open #2 / Risk 3).** Ship a *real* synchronous player trade in P6 as the
   game-#1 exercise of the custody/escrow saga (recommended), vs a CI-only property harness. The plan assumes the
   real trade — confirm.
3. **Mine floor layout: authored vs procedural.** Recommend authored floor templates first (simpler, trivially
   deterministic for replay), lightly-procedural later with a per-descent seed. Confirm the ladder/descent model
   (fixed exits vs seeded).
4. **Co-op concurrency.** Two visitors acting on the same plot/animal in one instanced room — the single-writer
   fence per SHARED resource exists (Fornax `holdsFence`), but confirm the conflict UX (last-writer vs reject) for
   co-op farming.
5. **Codename ratification.** Lock **Ceres** for `@celestia/game-cozy`; decide whether the world-clock
   (**Horologium**) and mine descent (**Erebus**) are distinct engine subsystems or modes of `Orrery`/the module
   (they are mostly room-type + content, so likely not standalone services).
6. **Marriage / global-exclusivity (PLATFORM.md Open #5).** PER_PLAYER "your-version" relationships ship now; a
   globally-exclusive marriage claim needs a SHARED claim + lease/escrow — defer unless committed.
7. **Energy/stamina model.** Stardew-style energy is a classic cozy gate on actions — is it in scope? If so it is
   a PER_PLAYER component + a `qualify()` requirement (game-state gate, PIPELINE.md §5), not an `allow()` concern.
8. **Town scale / channels.** When the shared town overflows one room, the Channels seam (WORLDS.md §7) spins
   copies — confirm the slow-tick town is the first place AoI/Sector filtering is actually needed, or whether a
   single town room suffices for the target concurrency.
9. **Fishing minigame authority.** Launch computes the catch server-side from a seed; if a skill-timing minigame
   is wanted, confirm it reports an **index into server-defined buckets** (G1), not a client score.
10. **Multi-world / save-slots (WORLDS.md).** Cozy is single-world now; if "each player's farm is a private world"
    (Stardew save-slot framing) is desired later, that's the `world_id` seam — additive, not a rework.

---

## 12. TL;DR

- **First vertical slice (prove before build):** world clock + ONE crop (parsnip) `till → plant → water → day
  advances → harvest → inventory → sell (COIN to ledger)`, on an **instanced ranch** with **persistence +
  deterministic offline fast-forward**, fully server-authoritative via Fornax. DoD: log off, advance the clock,
  re-enter → crops grew the *identical* amount; event-log replay reproduces the state; no client-sent number.
- **Top 5 missing pieces** (⚙ = engine-primitive, 🎲 = module):
  1. ⚙ `GameModule`/`ModuleRegistry`/`RoomCaps` contract + engine↔game split (extract the Atlas content seam) — nothing exists yet.
  2. ⚙ per-room-type tick driver (slow town + 20 Hz instanced) + **player-instanced room lifecycle** (`joinOrCreate(ranchId)` + load/fast-forward/dispose).
  3. ⚙ `caps.ledger`/Moneta EconomyService (no economy exists) + `caps.timer` (event-time) + `game_id` in `allow()` + `mod_cozy` schema.
  4. 🎲 the content packs (crops/items/recipes/villagers/animals/fish/forage/ore/calendar/weather/economy) + Caelum boot-validation extensions.
  5. ⚙ `caps.custody` + `escrowSwap` saga (for synchronous trade, P6) and 🎲 villager Pallas precedents + schemas.
- **Biggest open architectural question:** the **private-farm-vs-shared-town clock** — offline fast-forward
  demands growth be a pure function of authoritative game-time + seed (G9), but "sleep skips my farm's day" lets a
  private instance run ahead of the shared town clock; pick authoritative-town-time + reconciliation-on-enter vs a
  reconciliation UX (PLATFORM.md Open #7, §5.1).












