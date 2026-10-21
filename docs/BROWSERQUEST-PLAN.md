<!-- Implementation-ready plan for the FIRST Celestia GameModule to ship: BrowserQuest (@celestia/game-bq,
     proposed codename Perseus). Built ON the genre-neutral engine, NEVER a fork (G3). The authority for WHY the
     engine↔module boundary holds is docs/PLATFORM.md; this doc (a) re-sequences BrowserQuest AHEAD of the cozy
     life-sim as game #1 because it is closest to the current POC and lowest-risk, and (b) uses BQ as the vehicle
     to EXTRACT the engine from the Atlas monolith. Reads with: PLATFORM.md (spine), COZY-MMO-PLAN.md (game #2,
     so BQ's extraction must not contradict it), WORLDS.md, PIPELINE.md, CHARACTERS.md, COGNITION.md/DECISIONS.md,
     NAMING.md, .context guardrails. On any conflict the cited .context/ or docs/ file wins. -->

# BROWSERQUEST-PLAN.md — BrowserQuest on Celestia (`@celestia/game-bq`), the first GameModule

**Status:** DESIGN / implementation-ready plan — not built as a module yet (the *mechanics* mostly are; the
engine↔module *split* is not). **Owner:** Game #1 (BrowserQuest). **Spine:** `docs/PLATFORM.md` is authoritative
and designs the `GameModule`/`ModuleRegistry`/`RoomCaps` contract; this doc maps BrowserQuest onto it and schedules
the engine extraction. Every capability below is tagged **[E] ENGINE-primitive** (genre-neutral, `@celestia/*`) or
**[M] MODULE** (game meaning, `@celestia/game-bq`).

> **Proposed codename (NAMING.md §5 pattern, celestial canon):** the BrowserQuest module is **Perseus** — the
> archetypal sky-hero on a quest, who slays monsters and claims treasure; a real constellation. It resonates with
> BQ's loop (a lone adventurer wandering a shared world, hacking through mobs, looting weapons/armor). The package
> name stays the PLATFORM-fixed form **`@celestia/game-bq`** (mirroring `@celestia/game-cozy`); **Perseus** is its
> friendly-name/codename. Alternatives: **Orion** (the Hunter, sword-bearer — the melee-combat emblem),
> **Draco** (the Dragon — the monster/dungeon resonance), **Hydra** (the many-headed monster Hercules slew). These
> are proposals, not locked (NAMING.md "menu, not a verdict"; ratify in §10). BQ needs **no new engine subsystem
> codenames** — unlike cozy it does not need a calendar clock (Horologium) or a mine-descent manager (Erebus).

---

## 0. Thesis

**BrowserQuest is the lowest-risk first game *and* the vehicle that extracts the Celestia engine from the Atlas
monolith.** Two claims, both load-bearing:

1. **Celestia's current POC is already essentially BrowserQuest.** Real-time directional/click movement
   (Atlas 20 Hz authoritative sim + Jupiter client prediction/reconciliation/interpolation), the ECS, Pallas-driven
   mob AI with A\* pathfinding, melee combat through the Fornax pipeline (the **same** `attack` action reused by
   player and mob per G2), a content-driven monster roster (`content/mobs.json` + per-zone spawn tables,
   Caelum-loaded + boot-validated), zones/portals/maps/tilesets, and a renderer-agnostic client (Pictor) already
   drawing the **actual BrowserQuest sprites** (clotharmor / rat / skeleton / tilesheet) on two web clients. These
   are the hard, ruinous-to-retrofit parts (netcode, determinism, the action pipeline) — and they pass tests.
2. **So shipping BQ is mostly (1) formalize the engine↔module split + (2) add a few missing gameplay systems**
   (items/equipment, loot drops, chests, HP potions, NPC dialogue, achievements, world breadth). It is **not** new
   infrastructure. That makes BQ the ideal forcing function to build PLATFORM.md's `GameModule` contract *for real*,
   against mechanics that already work, where the split can be proven by a regression (the POC still plays,
   unchanged, now *as* a module behind the contract) rather than a leap of faith.

### 0.1 Why re-sequence BQ ahead of cozy (PLATFORM.md names cozy as module #1)

PLATFORM.md §1 names the cozy life-sim as `@celestia/game-cozy`, module #1, and `docs/COZY-MMO-PLAN.md` is already
written against that. **We re-sequence BrowserQuest first** on the "prove before build / seams before content"
principle (AGENTS.md working principles): BQ is one short extraction away from the running POC, whereas cozy needs a
world clock, instanced rooms, deterministic offline fast-forward, and an EconomyService that **do not exist yet**.
Shipping a playable game sooner, on code that already passes tests, de-risks the whole platform.

### 0.2 The discipline that keeps re-sequencing safe (the central warning)

PLATFORM.md §7.2 Risk 1 is explicit and names this exact trap: *"an extraction-shaped engine cannot host game #2."*
A naive "extract the engine from game #1" produces an engine **secretly shaped like game #1**, missing the primitives
game #2 needs, so game #2 forces TCB surgery in production — violating the no-fork promise (G3). BQ is *more*
dangerous here than cozy-first would have been, because **BQ exerts LESS pressure on the hard engine seams** than
either worked module in PLATFORM.md: BQ has no economy ledger, no instanced/match rooms, no custody/trade, no
per-seat hidden info, no turn barrier, no calendar. If we let BQ define the engine, we get an engine that can host
*only* BQ.

**Therefore the extraction is governed by three rules, enforced not promised:**

- **(R1) Build the `GameModule` contract GENERICALLY, with zero BQ-isms in the engine.** The engine learns about
  `components`, `archetypes`, `actions`, `events`, `room-types`, `enumerate`/`execute` — never about "a sword,"
  "a rat," "aggro," or "loot." Every BQ-specific noun lives in `@celestia/game-bq`. A `dependency-cruiser` arch-test
  fails the build on any `@celestia/<engine> → @celestia/game-*` edge (G3).
- **(R2) Keep cozy's future needs in view so cozy-as-game-#2 needs NO engine surgery.** The canonical contract we
  build is **Worked Example B's** from PLATFORM.md §3.2 — the *full* interface including the Match/turn/custody/
  viewFilter hooks — even though BQ implements several as near-vacuous stubs. We do **not** build their machinery now
  (YAGNI, §7.1 of PLATFORM.md), but we **do** reserve their shape in the interface so adding cozy's EconomyService,
  instanced farms, per-room tick, trade/escrow, and the Match room is *filling in hooks*, not re-opening the TCB.
  COZY-MMO-PLAN.md §4.0 lists cozy's engine gaps; every engine primitive BQ builds is one cozy will reuse, and this
  plan tags which (§3.4, §9.2).
- **(R3) Run the Conformance Test Kit (CTK) from day one.** PLATFORM.md §6's `runGameModuleConformance` is written
  during the extraction and runs in CI against `@celestia/game-bq`. It fails any module that cannot express a Match,
  skips `allow()`, reads scope from the client envelope, or lets a non-pure reducer through — the mechanical guard
  that the engine stayed genre-neutral even though only BQ is exercising it.

**Net:** BQ gets us a playable game fast and a *proven* engine↔module seam; the CTK + the full-shape contract + the
cozy cross-check keep that seam honest, so game #2 is content and hooks, not surgery.

### 0.3 The real deliverable is the CORE — and this is ONE evolving module, not two games

Read this section as the correction to the whole doc's framing. **The deliverable is the core** — the engine
primitives + the `GameModule`/`ModuleRegistry`/`RoomCaps` contract (the P0 extraction). **"BrowserQuest" is not a
product we are boxed into; it is the first, cheapest set of mechanics to grow on that core.** Two consequences the
rest of this plan is written to honor:

1. **We are NOT limited to BQ's feature set.** Combat, loot, items, equipment, shops, *and* crops/farming/time are
   all **additive module features + content on the same core**. They differ only in which ECS components, which
   content JSON, which `ActionDef`s, and which events they add — never in the engine underneath. A crop-yield rides
   the **exact same** ECS + content-driven Caelum + inventory machinery as combat-loot; a shop sale rides the same
   pipeline as an attack. So the order we build mechanics is chosen by **(a) what best proves/builds the core** and
   **(b) what is cheapest / most-already-done** — **not** by which genre a mechanic "belongs to."

2. **It is effectively ONE evolving game module — a Stardew-like** (real-time combat + a mine + farming + shops +
   loot + NPCs + progression) grown **mechanic-by-mechanic** on a solid core. "BQ-first" means only: *do the
   combat-shaped mechanics first because they are ~80% already built* (§2), while standing up the core — then layer
   crops/time/instancing. **Crops are NOT gated behind "finish BrowserQuest."** Once the core + the inventory/content
   pipeline exist (P0 + early P1), a farming mechanic can be pulled forward and **interleaved** with combat
   mechanics at any time, because it needs nothing combat does not already establish (store + content + inventory +
   a seeded yield in `execute`). The only things farming/time/instancing add that combat does not force are the
   **deep seams** (a slow world-clock tick, the instanced-room lifecycle, the EconomyService) — and those get their
   **generic shape laid early anyway** (§9), precisely so the farming mechanics can arrive whenever we want them.

**So this doc is really "the core + the combat/loot/shop mechanics first,"** and `docs/COZY-MMO-PLAN.md` is "the
farming/time/instancing mechanics layered onto the *same* core + module." They are **two views of one evolving
Stardew-like**, not two separate products — which is exactly why BQ's extraction must build the core generically
(R1) with cozy's needs in view (R2): the "second game" is really later mechanics on the first module. The roadmap
(§7) is therefore **core-first, then additive mechanics in flexible value/cost order**, with the combat cluster
first by cost, farming pullable forward whenever it earns its place.

---

## 1. Vision & core loops — BrowserQuest's actual loops

BrowserQuest (Mozilla, 2012) is a browser **real-time action MMORPG**: a lone adventurer in a shared, persistently
populated 2-D tile world, fighting aggroing monsters in melee, looting better weapons and armor, quaffing HP
potions, opening chests, chatting with other players and NPCs, and ticking off achievements — with famously **light
persistence** (your character and gear live only as long as your session/local id; the world itself is the
constant). The loops, each mapped to the Celestia action pipeline (`enumerate → allow → qualify → execute → event →
signal`, PIPELINE.md §4) and the tick model:

| Loop | What the player does | Tick tier | Pipeline verbs (intents — ids/indices only, G1) |
|---|---|---|---|
| **Explore / move** | click or steer across tiles between areas; cross area boundaries | Zone **20 Hz** | `move` (existing); area crossing = portal/seat-reservation (existing) |
| **Melee combat** | click a mob → auto-approach → trade hits until one dies | Zone **20 Hz** | `attack {targetId}` (**exists, reused verbatim**) |
| **Aggro / be hunted** | monsters notice you in range, chase, hit back; flee/fight | Zone **20 Hz** (autonomous) | none — Pallas mob AI (`actor=sim`, re-validated, G2) |
| **Loot drops** | a killed mob drops an item on the ground; walk over / click to pick up | Zone **20 Hz** | `loot {targetId}` (new) |
| **Equip gear** | equip a looted weapon/armor → stats **and** sprite change | Zone **20 Hz** | `equip {slot}` (new) |
| **Chests** | find a chest, open it → it yields an item | Zone **20 Hz** | `open_chest {targetId}` (new) |
| **HP potions / consumables** | drink a flask/eat food → restore HP | Zone **20 Hz** | `use_item {slot}` (new) |
| **Death / respawn** | HP hits 0 → you die → respawn at the start, keep (BQ: *lose*) gear | Zone **20 Hz** | none — `execute` on lethal `attack` emits death event |
| **NPCs & dialogue** | walk to an NPC → read a (scripted or Pallas-flavored) line | Zone **20 Hz** | `talk {targetId}` (new) |
| **Achievements** | perform a trigger (first kill, full equipment, find a secret) → unlock + toast | Zone **20 Hz** (server-detected) | none — achievement engine observes events |
| **Chat & presence** | type chat; see other players populate the shared areas | Zone **20 Hz** | `chat {text}` (bounded string — see §4, §8) |

### 1.1 Design tenets (BQ-specific, baked in)

1. **One shared, flat, persistent world of connected areas — no instancing.** BQ's world is a single large tilemap
   divided into *areas* (spawn areas, roaming areas, music areas, chest areas, PvP-free). This is the **existing
   World → Zone → Channel → Sector topology** (WORLDS.md): areas are Zones/Sectors in one World; crossing an area
   boundary is the **existing portal + seat-reservation** mechanic. BQ needs **no** `player-instanced` or
   `ephemeral-match` room — the single biggest reason it is lower-risk than cozy, which needs both.
2. **Server-authoritative, intents-only, same pipeline.** Every verb above is new *data* plugged into the existing
   Fornax stages (`enumerate → allow → qualify → execute → event → signal`), never a new path (PIPELINE.md §4).
   The client sends a target id or a slot/option index — never a damage number, a drop, an item name, or an HP
   value (G1). The server enumerates legality and computes every number.
3. **Equipment changes stats AND sprite, both server-driven.** Equipping an item is a server mutation that updates
   authoritative stats (max-HP/armor/weapon damage) and the player's synced `sprite`/`weapon` fields; the client
   re-skins from the wire `kind`/equipment, never from a local decision (G1/G3 — art is opaque to the server, the
   server ferries only the equipment `kind`).
4. **Combat already exists and is reused wholesale.** `attack {targetId}` → server-computed damage →
   `ENTITY_DAMAGED`/`ENTITY_KILLED` signals → Pallas-driven mob retaliation — the **same action for player and mob**
   (G2). Adding equipment means the damage *formula* reads the attacker's equipped weapon and the defender's armor
   from authoritative state; it is a richer `execute`, not a new engine.
5. **Light persistence is a feature, and event-sourcing is a free upgrade.** Classic BQ keeps almost nothing (a
   character is ephemeral; achievements persist client-side by local id). Celestia's event-sourced log (G4) lets us
   persist exactly as much as we choose (§5) — and gives replay/audit for free — without contradicting BQ's feel.
   **No EconomyService (G5) is needed**: BQ's loot is *drop-based*, not a currency economy. We do **not** build the
   ledger for BQ (cozy builds it, COZY-MMO-PLAN.md §4.f); we only make sure nothing BQ does contradicts that seam
   (§8).

---

## 2. What already exists — honest inventory of the POC mapped to BQ mechanics

The current POC is not "like" BrowserQuest; it is a thin BrowserQuest. The table below maps each BQ mechanic to the
**concrete artifact that implements it today**, with the honest status. (Verified against the running code, not
docs.) Legend: **✅ done & reused as-is** · **🟡 partial / BQ-shaped but inside Atlas** · **🧩 content, already
externalized to JSON** · **❌ missing (→ §4 gap)**.

| BQ mechanic | Current artifact (absolute path · symbol) | Status |
|---|---|---|
| Real-time directional/click movement | `services/atlas/src/ecs/systems/movement.system.ts` `MovementSystem`; client `packages/jupiter/src/ganymede/{predictor,interpolator,server-clock}.ts` | ✅ (predict/reconcile/interpolate pass tests) |
| Shared collision (client == server) | `packages/norma/src/index.ts` `isWalkable`/`isBodyWalkable`, `MOVE_SPEED`, `PLAYER_RADIUS` | ✅ |
| Melee combat / HIT / HURT / damage | `services/atlas/src/fornax/actions/attack.ts` `attackAction` (`ENTITY_DAMAGED`/`ENTITY_KILLED`), server-computed `hp = max(0, hp - damage)` | 🟡 (BQ-shaped ActionDef inside Atlas; damage is a flat injected number, no weapon/armor yet — §4.a) |
| Aggroing mobs / chase / retaliate | `services/atlas/src/ecs/systems/mob-ai.system.ts` `MobAISystem` (perceive→Pallas→act); labels `["flee","attack","wander","return"]` | 🟡 (mechanism generic; labels/kinematics are BQ content) |
| Mob AI as retrieval, not FSM | `services/atlas/src/pallas/*` (`Pallas`, `decideFromPrecedent`, `accept`, `PgPrecedents`); seed `services/atlas/src/content/mob-situations.ts` `MOB_TACTIC_SEED` | ✅ engine mechanism · 🧩 seed is content |
| A* pathfinding | `services/atlas/src/ecs/pathfind.ts` `findPath` (pure, radius-aware) | ✅ |
| **Same attack for player & mob** (G2) | `attackAction` dispatched for both; mob via `ZoneRoom.dispatchMobAttack`, re-validated server-side | ✅ |
| Monster roster (kind → sprite + stats) | `content/mobs.json` (rat, skeleton today); loaded by Caelum into `WorldRegistry.mobKind` | 🧩 (add BQ's full roster — §4; **no code change**) |
| Per-area mob spawns | `content/zones/<id>/zone.json` `mobs:[...]`; `ZoneRoom.seedMobs`/`spawnMobAt` | 🧩 / ✅ |
| Respawn after death | `ZoneRoom` corpse/respawn lifecycle (`MobAgent.deadUntil/corpseUntil`); `config/world.json` `respawn`, per-mob `respawnDelayMs` | ✅ (BQ's 30 s respawn is a content value) |
| Areas / zones / portals / maps / tilesets | Caelum (`packages/firmament/src/caelum`); `content/zones/*`; `ZoneRoom.checkPortals`/`transfer` + `reserveZoneSeat` | ✅ (BQ's doors/caves = portals; §4.h adds breadth) |
| Area network-interest (BQ "zone groups") | WORLDS.md Sector/AoI seam — **not yet** (`ZoneRoom` broadcasts all-to-all today) | ❌ seam (not BQ-blocking at POC scale) |
| Pictor render w/ real BQ sprites | `packages/pictor/src/*`; `content/assets/{sprites,img}/*` (clotharmor/rat/skeleton/tilesheet, 3 DPI scales) | ✅ (boxes↔sprites, walk/idle/atk anims, mob HP bars) |
| Character identity + placement persistence | `game_character` + `character_placement` (migration `0002`); `LobbyRoom` (Janus) + `ZoneRoom` load/save | ✅ (engine-owned, genre-neutral — CHARACTERS.md §9) |
| Session/account gateway, one-session/account, ban eviction | `services/atlas/src/janus/lobby.room.ts`, `services/atlas/src/themis/*` (`SessionRegistry` 4409/4403, revocation sweep) | ✅ |
| Event-sourced truth (seq/prev_hash, durable-before-ack) | `services/atlas/src/fornax/{event-chain,durable-event-sink,event-sink,signal-bus}.ts`; firmament `Repository` | ✅ |
| The action pipeline (`enumerate→allow→qualify→execute→event→signal`) | `services/atlas/src/fornax/{pipeline,types,astraea}.ts` `ActionPipeline`/`ActionDef`/`Astraea` | ✅ (generic; two ActionDefs are content) |
| Wire contract | `packages/norma/src/index.ts` (`PROTOCOL_VERSION=5`, `INTENT_TYPES=["input","attack","interact"]`, payloads) | ✅ / 🟡 (attack/interact are game verbs on a generic transport) |
| **Items / inventory / equipment** | — | ❌ (§4.a–b) |
| **Loot drops + chests** | — | ❌ (§4.c) |
| **HP potions / consumables** | — | ❌ (§4.d) |
| **NPCs + dialogue** | — | ❌ (§4.e) |
| **Achievements** | — | ❌ (§4.f) |
| **HP regen / armor-based max-HP** | flat `PLAYER_MAX_HP=20` in `content/player.ts` | ❌ (BQ: `maxHP=80+(armorLevel-1)*30`, §4.a/§4.d) |
| **Chat** | `MSG` has a reserved slot ("dialogue.* added later") | ❌ (§4.g/§8) |
| **Client game-UI layer** (health bar widget, inventory, equipment, chat, toasts, dialogue box) | only a one-line text HUD (`setHud(text)`); `World.selfHp/selfMaxHp` exist as data | ❌ (§4.i — needs a DOM/overlay layer; the single-string HUD seam is insufficient) |

**The honest headline:** every *hard* system (netcode, ECS, the action pipeline, event-sourcing, mob AI,
combat, zones, the content-driven roster, the renderer-agnostic client, identity/session/ban) is **done and
passing tests**. What is missing is a cluster of **additive gameplay content systems** (items/equipment, loot/
chests, consumables, NPCs/dialogue, achievements) plus one **structural refactor** (the engine↔module split,
§3) — and a **client UI layer** (§4.i). The subagent inventory confirms the code is *already staged* for the
split: nearly every file carries a header comment citing `docs/PLATFORM.md §2` and marking itself engine-generic
or "will move to a game module later (G3)."

### 2.1 The one BQ-vs-POC mechanic mismatch to fix during extraction

The original BrowserQuest is **client-initiated combat** (the client decides hit timing and even sends `HURT` on
its own behalf — trivially cheatable). Celestia's POC **already corrects this**: `attack {targetId}` runs through
Fornax server-side, the server computes damage and owns HP (G1). We **rebuild on Celestia, not port BQ's code** —
so the cheatable client-authority model is dropped by construction. This is the single most important "don't port,
rebuild" note: BQ's mechanics are the spec; BQ's netcode/authority model is explicitly *not*.

---

## 3. Mapping onto the `GameModule` contract — the P0 engine↔module extraction

P0 is the **engine↔module split**: move the BQ-specific code out of Atlas into `@celestia/game-bq` behind the
`GameModule`/`ModuleRegistry`/`RoomCaps` contract, leaving Atlas as the genre-neutral engine host — and prove it by
a **regression**: the current POC still plays, unchanged, now *as* a module. No new gameplay in P0 (that is P1+).

### 3.1 Dependency direction + composition root (G3)

```
@celestia/atlas (+ engine pkgs)  ──imports──▶  @celestia/game-contract   (interfaces + leaf types ONLY)
@celestia/game-bq                ──imports──▶  @celestia/game-contract, @celestia/atlas-engine
engine                           ──NEVER────▶  @celestia/game-bq
```

Wired only at a per-game composition root: today `ZoneRoom`/`LobbyRoom` are hardcoded via `gameServer.define("zone")`
in `main.ts`; this becomes `engine.mount(cfg.game.driver)` with `cfg.game.driver === 'bq'`, a server-boot singleton,
**never** sourced from client join options. A `dependency-cruiser` arch-test fails the build on any
`@celestia/<engine> → @celestia/game-*` edge (G3). (COZY-MMO-PLAN.md §4.0 lists the identical foundational gap for
cozy — this is shared engine work, done once, here.)

### 3.2 What moves OUT of Atlas into `@celestia/game-bq` (the extraction manifest)

From the server-code inventory, the extraction surface is precise and small:

| Moves to `@celestia/game-bq` | From (current path) | Becomes (contract hook) |
|---|---|---|
| `attackAction` (combat) | `services/atlas/src/fornax/actions/attack.ts` | an `action('attack', …)` registered via `ModuleRegistry`; its `enumerate`/`allow`/`qualify`/`execute` are the module's `ActionDef` |
| `leverAction` (interact) | `services/atlas/src/fornax/actions/lever.ts` | `action('interact', …)` (or dropped — no BQ consumer; keep as the generic-interaction proof or move to module) |
| Mob tactic labels + `act()` kinematics | `ecs/systems/mob-ai.system.ts` (`ACTIONS`, thresholds) | module-declared decision-schema + the act-label→kinematics mapping; the perceive→Pallas→act **mechanism stays in the engine** |
| Perception encoder + seed | `content/mob-situations.ts` (`describeSituation`, `MOB_TACTIC_SEED`) | module content registered via `decisionSchema(...)` + `content(...)` |
| Player combat stats | `content/player.ts` (`PLAYER_MAX_HP`, `PLAYER_DAMAGE`, `PLAYER_ATTACK_REACH`, `PLAYER_LEVEL`) | module content (→ armor/weapon-derived once equipment lands, §4.a) |
| Concrete component field sets | `schema/ZoneState.ts` (`Player`/`MobState`/`LeverState` fields: hp/level/kind/action/on) | module `component(...)` declarations; the engine stores/syncs what it is told (PLATFORM.md §2 row 1-2) |
| Concrete component maps | `ecs/world.ts` (`MobAgent`, `PlacementRef`, which maps exist) | module-declared components; `World` becomes a generic store parameterized by the registry |
| Game intents | `norma` `INTENT_TYPES` entries `attack`/`interact` + `AttackCommand`/`InteractCommand` | module-declared action payloads (still in a shared wire place, but owned by the module's `action()` registration) |
| Mob roster / zones / maps / spawn tables | `content/mobs.json`, `content/zones/*`, `config/world.json` | **already externalized**; re-homed under the module's `content()` manifest (Caelum stays the engine loader) |

### 3.3 What STAYS in the engine (genre-neutral, built/kept generically — R1)

All verified genuinely generic by the inventory, kept in `@celestia/atlas`/engine packages:

- **ECS core** — `ecs/types.ts` (`System`/`World`/`TickContext`/`EntityId`), the store/lifecycle pattern in
  `ecs/world.ts`, `ecs/pathfind.ts` (pure A*), `MovementSystem` (kinematic integration).
- **Fornax pipeline** — `pipeline.ts` (`ActionPipeline`), `types.ts` (`ActionDef<W>`/`ResolvedAction`/`Intent`/
  `GameEvent`/`Signal`/`ActionOutcome`), `event-sink.ts`/`durable-event-sink.ts`/`event-chain.ts`/`signal-bus.ts`,
  `astraea.ts` (the `allow()`/`qualify()` gates). **The stage order is the security spine** (PIPELINE.md §4) and
  must not change. The `fornax/index.ts` re-export of the two concrete actions is the **one export to break**.
- **Pallas** — the entire decision mechanism (`types`, `pallas`, `precedent`, `accept`, `mnemosyne`, `pg-precedents`).
- **Rooms/identity** — `rooms/seat-reservation.ts`, `janus/lobby.room.ts`, `themis/*` (session registry + revocation).
- **Caelum + Repository + norma transport** — topology/roster loader & graph validation; the `Repository` port
  (placement, event log, precedents); `PROTOCOL_VERSION`, seat/session/zone-map/asset/ping contracts, collision
  helpers. The engine ferries `kind`→sprite **opaquely** (G3 — "the engine never learns what a sprite is").

### 3.4 The `GameModule` contract BQ implements (full Worked-B shape; BQ stubs the Match half — R2)

BQ implements the PLATFORM.md §3.2 interface. The split of real-vs-stub is the whole point: build the **shape**
generically, implement only what BQ needs, leave cozy's hooks reserved.

| Contract member (PLATFORM.md §3.2) | BQ implementation | Cozy will… |
|---|---|---|
| `gameId='bq'`, `schemaNamespace='mod_bq'`, `engineContractVersion` | real | same shape, `'cozy'`/`'mod_cozy'` |
| `declare(reg)` — `component`/`archetype`/`action`/`event`/`decisionSchema`/`content`/`roomType` | **real** (all BQ content, §3.5) | reuse; add `economy`/`assetKind`/`progression` |
| `onRoomCreate`/`onJoin`/`onTick`/`onLeave`/`onRoomDispose` | **real** (today's `ZoneRoom` bodies, split into hooks) | reuse; add instanced load/fast-forward/dispose |
| `resolveResource`/`enumerate`/`execute` | **real** (the existing Fornax `ActionDef` stages map 1:1) | reuse |
| `isTurnComplete`/`resolveTurn`/`projectMatchResult`/`applyMatchResult`/`onForfeit`/`viewFilter` | **STUB** (BQ is real-time open-world; no Match) | reuse thin forms (trade-confirm, co-op redaction) |
| `buildDecisionFrame`/`onDecision` | **real** (mob AI already does exactly this) | reuse for villagers |
| `buildDialogueRequest`/`onDialogueIntents` | **stub→real at P2** (NPC dialogue; scripted first, §4.e) | reuse for villager S2 dialogue |
| `render: RenderPackageRef` | the Pictor/pyxis backend (web POC); Godot/astrolabe later | its own render package |

`RoomCaps` usage for BQ: `store` (entities), `events` (append `bq.*@1`), `clock` (read `ZoneState.t`), `rng`
(seeded loot/respawn/damage rolls — G9), `cognition`/`memory` (mob AI, later NPC dialogue), `timer` (respawn/potion
cooldowns, §9.2 #14), `log`. BQ uses **neither** `ledger` (no economy, G5 — §8) **nor** `custody`/`match` (no
trade, no match rooms) — those handles exist in the shape and BQ simply never calls them.

### 3.5 What `declare()` registers for BQ

- `component(...)`: `position`, `sprite` (shared-wire); `health{hp,maxHp}` (shared-wire); `equipment{slots: map<slotId,
  itemId>}` (shared-wire — a **generic slot→item map**, NOT fixed weapon/armor fields; drives derived stats + the
  sprite layers, §4.a); `inventory{slots}` (per-player); `statuses{list}` (server-authoritative temporary modifiers
  + flags, §4.d.1; synced subset for FX); `mobAgent` (server-only brain — aggro/home/respawn); `groundItem{kind}`,
  `chest{loot}`, `npc{kind}` (shared-wire).
- `archetype(...)`: `player` (PER_PLAYER identity, SHARED presence), `monster` (SHARED-within-zone), `ground_item`
  (SHARED), `chest` (SHARED), `npc` (SHARED).
- `action(...)`: `move`/`attack` (exist) + `loot`, `equip`, `use_item`, `open_chest`, `talk`, `chat` — each tagged
  with one closed `authzClass` (mostly `write_owned`/`interact_shared`) and a `locate` returning ids/indices only (G1).
- `event(...)`: existing combat events + `bq.item_looted@1`, `bq.item_equipped@1`, `bq.chest_opened@1`,
  `bq.item_used@1`, `bq.health_changed@1`, `bq.status_applied@1`, `bq.status_expired@1`, `bq.player_died@1`,
  `bq.player_killed_mob@1`, `bq.achievement_unlocked@1` — each a pure `apply()`.
- `decisionSchema(...)`: `mob.tactic` (exists) — reused verbatim; NPC dialogue schema at P2.
- `roomType(...)`: `zone` = `{ persistence:'persistent-pinned', tick:{kind:'interval',hz:20}, interest:'spatial-grid',
  visibility:'open', seats:{roster:'open'} }` — the **only** room type BQ needs (no Match). The `hz:20` is promoted
  from today's per-zone `tickHz` to a room-type property (§9.2 #3).
- `content(...)`: the Caelum manifests of §6 (mobs extended, equipment, items, npcs, chests, achievements, zones).

### 3.6 Definition of done for P0 (the proof the split holds)

- `@celestia/game-contract` + an engine/`game-bq` package split; `dependency-cruiser` arch-test **red** on any
  engine→game edge (G3).
- `engine.mount('bq')` replaces the hardcoded room `define`; the composition root names the only concrete module.
- The **entire current POC plays unchanged** as `@celestia/game-bq`: login → lobby → zone → move → attack a
  rat/skeleton → mob AI aggros and retaliates → respawn — all green, all existing tests passing.
- **CTK (PLATFORM.md §6) runs in CI against `@celestia/game-bq`** and is green: every mutating intent routes
  `allow()` before execute; `resolveResource` reads scope/owner from authoritative state not the envelope;
  `game_id` is enforced; every `bq.*@1` event has a pure replay-round-tripping reducer; `enumerate()` returns a
  bounded option set; the module can *express* a Match (even though BQ stubs it); no module re-declares an engine
  handle/port name.

---

## 4. Gap analysis — the genuinely missing gameplay systems

Each system uses the same template: **[E]/[M] tag**, **Caelum content schema** (mirroring `content/mobs.json`),
**ECS components/systems**, **norma intents** (ids/indices only, G1), **events + persistence**, **guardrail
notes**. All numbers below are BQ's authoritative values (from the vendored source); they live in **content/config,
never inline literals** (G8). The exhaustive rosters are here; the schema shapes are in §6.

### 4.0 The unified action shape — one depletable-pool + fixed-effect-set + drop-roll mechanism

Before the individual systems: **attack, mine, chop, and harvest are the SAME shape**, and the engine should
provide that shape once rather than as bespoke per-verb code. The unifying insight:

> A targeted entity has a **depletable pool** (hp / durability / ripeness — one component shape: `{value, max,
> onZero}`); an action reduces it by a **server-computed amount**; crossing zero fires a **terminal effect**
> (death / depletion / harvest) that **rolls a drop/yield table into the actor's inventory**.
> `attack(mob: hp, weapon→dmg, →loot)` ≡ `mine(node: durability, pickaxe→dmg, →ore)` ≡
> `harvest(crop: ripeness, →yield)`. Same machinery, different content.

- **Keep distinct `ActionDef`s — do NOT collapse into one mega-action.** `attack`/`mine`/`chop`/`harvest` have
  different `enumerate`/`allow`/`qualify`, different target types, and different required tools (the §4.a equipment
  slot gates which action you can do — a pickaxe enables `mine`). The *verbs stay separate*; only the *outcome
  machinery* is shared.
- **A small FIXED set of reusable effects** the engine applies + logs uniformly. Each action's `execute` computes
  the numbers (server-authoritative, G2) and **returns effects + events**; the engine applies them and appends the
  events. `attackAction` already returns `{events, commit}`, so it is **half-way there** — the refactor is to
  express "what happened" as this shared effect vocabulary and extract the depletable-pool + drop machinery so
  `mine`/`harvest` reuse it verbatim. The fixed set:

  | Effect | Meaning | Reused by |
  |---|---|---|
  | `damage{target, amount}` | reduce a pool (hp/durability/ripeness) by a computed amount | attack, mine, chop, harvest |
  | `heal{target, amount}` | increase a pool toward max | potions, regen |
  | `deplete{target}` | force a pool to zero (fire its `onZero`) | chest-open, instant-pick |
  | `rollDrop{target, table}` | roll a content drop/yield table, producing `grantItem`s | mob death, node depletion, crop harvest, chest open |
  | `grantItem{actor, item, qty}` | add an item to the actor's inventory | the terminal of every drop/yield path |
  | `consumeDurability{tool, amount}` | wear an equipped tool (optional; BQ gear doesn't wear, cozy tools may) | mine/chop/harvest (if tiers wear) |
  | `applyStatus{target, status, durationMs}` | time-boxed flag (invincibility, buff) | firepotion, future buffs |

- **Shared machinery (the payoff).** **One** `rollDrop → grantItem → inventory` path serves combat-loot **and**
  mining-yield **and** crop-harvest; **one** depletable-pool component shape (`health` / `durability` / `ripeness`
  are the same `{value,max,onZero}` component with different stat names + terminal hooks). Build it once for BQ's
  combat; mine/chop/harvest are then content + a thin `ActionDef`, not new systems.
- **Engine vs module.**
  - **[E] ENGINE:** the pipeline; the **generic depletable-pool component**; the **fixed effect set** (applied +
    event-logged uniformly); the **drop-roll + drop→inventory** path; event-sourcing of every effect.
  - **[M] MODULE:** the actions themselves (`attack`/`mine`/`harvest`), the stat formulas (how a weapon/pickaxe →
    `amount`), the target types, and the **drop/yield tables** (content — §6).
- **Why the mine (and cozy harvest) "needs the least work."** A mine is combat pointed at an ore node: `mine` reuses
  the depletable-pool (node `durability` instead of mob `hp`), the server-computed reduction (pickaxe tier → amount,
  §4.a equipment), and the `rollDrop`→inventory path (ore table instead of loot table). **No new combat/gather
  engine** — the exact reason COZY-MMO-PLAN.md §4.l calls the mine "mostly reuse." Crop harvest is the same with
  `ripeness` as the pool and a single-item yield (§10).
- **YAGNI guardrail.** A **small FIXED effect set**, NOT a data-driven effect-scripting DSL / rules engine — that is
  over-engineering until a committed game proves the need (PLATFORM.md §7.1). Numbers are server-computed (G2),
  seeded (G9), logged as events (G4); **content provides tables/tiers, never formulas**. Adding an effect is a
  deliberate engine change, not an open extension point.
- **Guardrails.** G2 (every amount/drop server-computed, never client-asserted), G9 (seeded rolls), G4 (effects are
  events), G1 (the action carries a target id + tool slot, never an amount).

### 4.a Inventory & equipment — SLOT-GENERIC gear (configurable slots + additive stat modifiers)

Equipment is **not** hardcoded weapon/armor. It is **generic stat-boosting items in content-declared slots**: a
slot-map component, generic modifier aggregation, and a module-provided formula. "Weapon" and "armor" are just the
two slots BQ declares; an RPG adds `shield`/`head`/`ring1`/`ring2`/`accessory`, and **cozy's tools are the same
system** (a tool = equipment in a tool slot — §10) — all with **zero engine change**.

- **The engine↔module split (explicit).**
  - **[E] ENGINE / generic:** the `equipment{slots: map<slotId, itemId>}` component + per-player sync; the
    `equip`/`unequip` **actions**; **slot-fit + rank validation** (does the item declare this slot? does the
    module's rank rule allow it?); **modifier aggregation** = `derived[stat] = base[stat] + Σ(equipment modifiers)
    + Σ(active status modifiers)` (§4.d) — **one** pure, game-agnostic fold over both *equipped-while* (equipment)
    and *temporary* (buff/status) modifiers; ferrying each equipped item's `kind`→sprite **opaquely** (G3). The
    engine knows *slots*, *items*, *statuses*, and *a number map* — never "weapon," "armor," "buff," or "damage."
  - **[M] MODULE (bq):** the **slot set** it declares (`["weapon","armor"]`), the **stat set** it uses
    (`damage`, `maxHp`), the item roster + each item's `slot` + `modifiers`, and the **formula** that maps aggregated
    modifiers → the final combat number (BQ's `dmg`/`maxHP`, below). The rank/tier policy is module content.
- **BQ content (authoritative — same numbers, expressed as slot + modifiers).** The `weapon` slot, worst→best
  (`rank`, `damage` modifier): `sword1`(0,+1), `sword2`(1,+2), `axe`(2,+3), `morningstar`(3,+4), `bluesword`(4,+5),
  `redsword`(5,+6), `goldensword`(6,+7) — the modifier is BQ's `weaponLevel = rank+1`. The `armor` slot, worst→best
  (`rank`, `maxHp` modifier): `clotharmor`(0), `leatherarmor`(1), `mailarmor`(2), `platearmor`(3), `redarmor`(4),
  `goldenarmor`(5) — the `maxHp` modifier is derived from BQ's `maxHP = 80 + (armorLevel−1)×30` (cloth 80, leather
  110, mail 140, plate 170, red 200, golden 230; `armorLevel = rank+1`). Plus the transient `firefox` armor
  (firepotion effect, not ranked). Starting loadout: `{weapon: sword1, armor: clotharmor}`. Schema §6.2.
- **ECS.** New shared-wire `equipment{slots}` + `health{hp, maxHp}` on the player (replacing the flat
  `PLAYER_MAX_HP`). An `equip` recomputes the derived stat map via aggregation; the module's formula sets `maxHp`
  and refills (BQ behavior). The synced `equipment.slots` is what the **client re-skins from** (each equipped item
  may contribute a **visual layer** for its slot — §4.a-sprite below).
- **Intents (norma, G1).** `equip {slot}` — `slot` indexes the player's inventory; the server reads the item kind +
  its declared equipment slot from authoritative state and applies it. `unequip {slotId}`. **No stat/damage/HP
  value ever crosses the wire.** BQ's "only a higher rank" rule is a server-side `qualify()` check (not a client
  gate as in the original) over the item's `rank` vs the currently-equipped item's `rank`.
- **Combat formula (the module mapping over aggregated modifiers).** The existing `attackAction` stays the same
  ActionDef; its `execute` reads the attacker's and defender's **derived** stat maps (engine-aggregated from their
  equipped items' `modifiers`) and applies BQ's module formula `dmg = derived.weaponDamage × randInt(5,10) −
  derived.armorLevel × randInt(1,3)` (floor `randInt(0,3)`), with `caps.rng` the only randomness (G9 — seeded,
  replayable). Mobs carry fixed `damage`/`armorLevel` stats in `content/mobs.json` (BQ's Properties table; a mob is
  just an entity with a base stat map, no equipment slots needed). HP regen (`floor(maxHp/25)` every ~2 s) is a tiny
  engine-timer-driven `RegenSystem` (§9.2 #14). **The mechanism (slot-map + additive modifiers + aggregation) is
  generic; the formula and stat names are module.**
- **Sprite re-skin (generalized).** Not "armor = body sprite, weapon = overlay" baked in — instead **each equipped
  item may declare a visual layer for its slot** (`layer: "body" | "overlay" | …` + its sprite `kind`). The server
  sends the equipped `kind`s per slot; the client composites the layers (armor→body layer, weapon→overlay layer for
  BQ) by mapping each `kind`→art via `AssetManifest`. The engine ferries kinds + a `layer` tag opaquely and **never
  learns what a sprite is** (G3). Adding a `shield`/`head` slot = another layer, no engine change.
- **Persistence.** `bq.item_equipped@1 {slotId, itemKind}`; projection `mod_bq.equipment(character_id, slot_id,
  item_kind)` — a **slot-keyed row set**, not fixed weapon/armor columns (§5). Inventory via `bq.item_gained@1`/
  `bq.item_consumed@1` → `mod_bq.inventory`.
- **YAGNI line (right-sized).** Stop at **slots + additive stat modifiers + a module formula**. Modifiers are a flat
  `stat→value` map aggregated by sum; this already expresses BQ (and cozy tools). Do **NOT** build a buff/proc/
  enchant/conditional-effect engine, set bonuses, or a modifier DSL unless a committed game needs them — the slot-
  set + modifiers shape is the sweet spot and is cleanly extensible later (PLATFORM.md §7.1 guiding cut).
- **Guardrails.** G1 (slot index only; server owns the formula + rank-gate + aggregation + numbers), G9 (seeded
  damage rolls), G3 (item kinds + layer tags carried opaquely; the engine never interprets art or stat meaning),
  G4 (equip/unequip are events).

### 4.b Item content / registry

- **[M]** the item registry is pure content; **[E]** Caelum loads + boot-validates it (same as `mobs.json`).
- **BQ content.** Equipment (§4.a) + objects: `flask`, `burger`, `cake`, `firepotion`, `chest` (§4.c/§4.d). Each
  entry is `{sprite, category, ...effect}` (§6.2 `content/bq/{equipment,items}.json`). Group predicates (`isItem`,
  `isHealingItem`, `isExpendable`) become `category` tags, not code.
- **Guardrails.** G8 (every stat is a content value, no inline literals), G3 (sprite opaque).

### 4.c Loot drops + chests

- **[E]** the generic `store` + a `ground_item`/`chest` archetype + `caps.rng` + `caps.timer` (despawn). **[M]** the
  per-mob drop tables, chest contents, pickup/open legality.
- **BQ content (authoritative drop tables — cumulative % roll, remainder = no drop).** Per-mob, e.g. `rat`:
  flask 40, burger 10, firepotion 5; `skeleton`: flask 40, mailarmor 10, axe 20, firepotion 5; `ogre`: burger 10,
  flask 50, platearmor 20, morningstar 20, firepotion 5; `boss`: goldensword 100 (always). (Full 13-mob table in
  the §6 `loot` blocks on `content/mobs.json`.) **Chests** come in two flavors: **static chests** (13 fixed, fixed
  item list) and **chest areas** (8 rooms that, when cleared of mobs, spawn a reward chest with the area's item
  list). Opening a chest yields **one random item** from its list. Dropped items blink at 10 s and vanish at 14 s;
  static items respawn 30 s after pickup.
- **ECS.** New `GroundItem` entity (shared-wire `{kind, x, y}`) spawned on a lethal kill via the **shared `rollDrop`
  effect (§4.0)** — the same drop-roll→inventory machinery reused by mining-yield and crop-harvest — and by
  `open_chest`. A `ChestAreaSystem` observes `ENTITY_KILLED` signals and, when an area's
  mob set empties, spawns the reward chest (BQ's exact mechanic — it rides the existing signal bus). Item despawn
  is a `caps.timer` wake-up (§9.2 #14).
- **Intents (norma, G1).** `loot {targetId}` — targetId = a ground-item entity id (BQ: walk onto / click). `open_chest
  {targetId}` — targetId = a chest entity. The server picks the dropped/opened item (`caps.rng`), adds it to the
  looter's inventory; the client sends no item kind or quantity.
- **Persistence.** `bq.item_looted@1 {item, from}`, `bq.chest_opened@1 {chest, item}`. Ground items and chests are
  **SHARED zone state rebuilt on room create** — not per-player saves (§5.2). Drop rolls are seeded + event-sourced
  → replayable (free anti-cheat, PLATFORM.md §4.2 applied to loot).
- **Guardrails.** G1 (target ids only; server rolls drops + picks chest item), G9 (seeded rolls), G4 (loot/open are
  events), G6 (`loot`/`open_chest` pass `allow()`; a ground item is SHARED, single-writer-fenced so two players
  can't both loot it — §9.2 #5).

### 4.d Consumables — item USE-EFFECTS over the §4.0 fixed effect set (no bespoke "potion" system)

A consumable is **not** a special "potion"/"food" type — it is any item declaring `use: { effects: [...] }` using
the §4.0 **fixed effect set**. The existing `use_item` action reads the item's declared effects, `qualify()`s
(have it, off cooldown, target valid), `execute`s them (server computes every number, G2), applies the effects, and
decrements the stack. **No "potion"/"food" hardcoding** — a healing item and a buff item differ only in their
declared effects.

- **[E]** `store` + the `use_item` action stage + the §4.0 effect application + `caps.rng`/`caps.timer`.
  **[M]** which items are consumable + their declared effects (content).
- **BQ content (as declared effects).** `flask` → `[{heal: 40}]`, `burger` → `[{heal: 100}]` (the `heal` effect
  already no-ops at full HP); `cake` → `[]` (cosmetic — the hidden-portal easter-egg that unlocks `FOR_SCIENCE`,
  §4.f); `firepotion` → `[{applyStatus: "invulnerable", ms: 15000}, {applyStatus: "firefox_skin", ms: 15000}]`
  (invincibility + the `firefox` sprite swap, both auto-expiring; looting any armor cancels early — a module rule).
  Schema §6.2 (`items.json` gains a `use.effects` block).
- **Intents (norma, G1).** `use_item {slot}` — slot index only; the server reads the item + its declared effects and
  computes/applies them. No heal/HP/duration value crosses the wire.
- **Persistence.** `bq.item_used@1 {item}` + the §4.0 effects' own events (`bq.health_changed@1 {delta}`,
  `bq.status_applied@1 {status, expiresAt}`). Consumables are inventory items (§5).
- **Guardrails.** G1 (slot only; server computes effects + owns HP/status), G9 (any randomness seeded), G4, G2.

### 4.d.1 Status / buff system (minimal for BQ, generic shape)

Statuses are **temporary modifiers + flags** on an entity, applied via the §4.0 `applyStatus` effect and expired/
ticked by a timer-driven system. BQ needs only `invulnerable` (firepotion) and HP-regen, but the *shape* is the
generic buff/debuff primitive cozy (tool-buffs, food buffs) and a future RPG/Pokémon (spells, poison, stat stages)
reuse with zero engine rework.

- **Component.** `statuses` (server-authoritative; synced subset for client FX): a list of
  `{ id, modifiers: {stat→value}, flags: [...], expiresAt, stacks, source }`.
- **Numeric modifiers fold into the SAME aggregation as equipment (§4.a).** `derived[stat] = base + Σ(equipment
  modifiers) + Σ(active status modifiers)` — buffs are *temporary* modifiers, equipment are *equipped-while*
  modifiers, **one fold**, one code path. A +2-damage buff and a +2-damage sword are identical to the aggregator.
- **Flags = a small FIXED condition vocabulary** honored by core systems — NOT a DSL. The documented set starts
  minimal: `invulnerable` (the §4.0 `damage` effect zeroes against a target holding it — this is where BQ's
  firepotion invincibility lives, server-side, replacing the original's client-side HURT suppression), plus
  `firefox_skin` (a cosmetic sprite-layer swap, §4.a). Extended only when a committed game needs a new flag; each
  flag is a deliberate engine change wired into the specific system that honors it.
- **Lifecycle.** Applied via `applyStatus` (§4.0). A **`StatusSystem` on `caps.timer`** (seeded event-time, G9)
  expires lapsed statuses and runs periodic ticks (a status may carry a per-tick effect, e.g. a heal or a poison
  `damage`). **Stacking is an enumerated per-status policy:** `stack | refresh | strongest | ignore` (content-
  declared), so re-applying a status is deterministic.
- **Reconcile with the `RegenSystem` (§9.2 #14).** BQ's out-of-combat HP regen (`floor(maxHp/25)` every ~2 s) is
  *exactly* a periodic status: a permanent/implicit status whose per-tick effect is a `heal`. It can be the **first
  periodic-status** (regen = a built-in status) or stay its own small system — either way, **regen, poison, and
  firepotion all ride the same statuses + `caps.timer` shape**; we do not build three bespoke tickers.
- **Engine vs module.** **[E]** the `statuses` component; expiry + periodic tick on `caps.timer`; the fixed flag
  vocabulary; aggregation-includes-statuses (§4.a); the stacking-policy mechanism. **[M]** which statuses exist +
  their numbers/flags/policies (content — `content/bq/statuses.json`; BQ ships only `invulnerable`, `firefox_skin`,
  and `regen`).
- **Intents.** None directly — statuses are applied by effects (consumables, future skills), never client-asserted.
- **Persistence.** `bq.status_applied@1 {entity, status, expiresAt}`, `bq.status_expired@1 {entity, status}` (pure,
  seeded, replayable). The firepotion invincibility window is thus event-sourced, not a wall-clock flag.
- **YAGNI.** A fixed flag vocabulary + numeric modifiers + a per-tick effect + a stacking enum — **not** a
  status-scripting DSL or conditional-trigger engine. BQ builds `invulnerable` + `regen`; the generic shape is
  designed now (so cozy/RPG slot in) but no speculative statuses are authored.
- **Guardrails.** G2 (all status numbers server-computed; never client-set), G9 (timer keyed to event-time, seeded),
  G4 (apply/expire are events), G1 (`use_item` sends a slot, the status carries no client number).

### 4.e NPCs + dialogue (DECISION: scripted first, Pallas-flavored later)

- **[E]** the `npc` archetype + the dialogue message channel + (later) the Pallas/Mnemosyne spine that already
  exists for mobs. **[M]** the NPC roster + the lines (or the dialogue decision schema).
- **DECISION.** **Ship scripted static dialogue first** (BQ's dialogue is 100% static client-side `NpcTalk` text,
  cycling per click). This is pure content and matches the original exactly — lowest risk, no model dependency
  (consistent with MEMORY "defer live model; precedents/scripts until wired"). **Pallas-flavored NPC dialogue is a
  later, optional upgrade** (P2+): route `talk` through the same `buildDialogueRequest`/`onDialogueIntents` hooks
  the contract reserves, with S2 (Calliope) when the model is wired — candidate lines re-validated (G2). For BQ's
  faithful feel, scripted is the launch target; the Pallas path is the engine-reuse demonstration, not a requirement.
- **BQ content.** NPC kinds with dialogue: `guard`, `king`, `villagegirl`, `villager`, `agent`, `rick` (Rickroll →
  `RICKROLLD`), `scientist`, `nyan`, `priest`, `sorcerer`, `octocat`, `coder`, `beachnpc`, `desertnpc` (+ unused
  `forestnpc`/`lavanpc` stubs). Placed on the map: king/coder/nyan/rick/villager/priest/agent/villagegirl/octocat/
  sorcerer/beachnpc/scientist/desertnpc ×1, guard ×10. Schema §6.2 (`content/bq/npcs.json`, `lines:[...]`).
- **ECS.** `npc` archetype (SHARED, shared-wire `{kind, x, y}`); NPCs are static (no movement needed; optionally a
  Pallas schedule later). Dialogue is **stateless server-side** for the scripted path: the client cycles lines it
  received, or the server streams a line via a `dialogue.line` message.
- **Intents (norma, G1).** `talk {targetId}` — targetId = an NPC entity; the server returns the NPC's line(s) (new
  `MSG.dialogue` channel — the reserved slot). No free text from the client in the scripted path.
- **Persistence.** First-talk can emit `bq.npc_talked@1 {npc}` to drive the `SMALL_TALK`/`RICKROLLD` achievements
  (§4.f). Dialogue content itself is not persisted.
- **Guardrails.** G2 (if/when Pallas/S2 is used, lines are re-validated; the model never writes state), G1 (scripted
  path sends an NPC id, not text), G3 (NPC sprite opaque).

### 4.f Achievements

- **[E]** a generic **event-observing achievement detector** is *almost* genre-neutral, but BQ's triggers are
  game-specific (kill counts, geofences, loot types), so: **[M]** the achievement roster + triggers;
  **[E]** the mechanism = a listener over the existing `SignalBus`/event stream + a per-character unlocked set. This
  is a pure observer — **no new seam** (§9.2 #11).
- **BQ content (20 achievements, authoritative).** Event-driven: `A_TRUE_WARRIOR` (loot a weapon), `FAT_LOOT` (loot
  armor), `ANGRY_RATS` (10 rats), `SKULL_COLLECTOR` (10 skeletons), `HUNTER` (50 kills), `HERO` (kill boss),
  `SMALL_TALK` (talk to an NPC), `RICKROLLD` (talk to rick), `NINJA_LOOT` (loot a drop you didn't fight for),
  `COWARD` (teleport with attackers), `STILL_ALIVE` (revive 5×), `MEATSHIELD` (take 5000 dmg), `FOXY` (loot
  firepotion, hidden), `FOR_SCIENCE` (loot cake, hidden). Geofenced: `INTO_THE_WILD`, `AT_WORLDS_END`, `TOMB_RAIDER`,
  `NO_MANS_LAND`, `HOT_SPOT`, `UNDERGROUND` (enter specific map regions / cave-music areas). Schema §6.2.
- **Where BQ had it on the client, Celestia makes it server-authoritative.** Classic BQ counted kills and checked
  geofences on the client and persisted unlocks in `localStorage`. On Celestia the **detector is server-side**,
  observing `bq.player_killed_mob@1`/`bq.item_looted@1`/placement events; geofences become server checks against the
  player's authoritative position/zone. This closes BQ's "clear cache, lose achievements" and client-spoofing holes.
- **ECS/engine.** An `AchievementSystem` (or a signal listener) increments per-character counters and evaluates
  triggers; on unlock it emits `bq.achievement_unlocked@1` and pushes a toast message to the client.
- **Intents.** None — achievements are server-detected (G1: never client-asserted).
- **Persistence.** `bq.achievement_unlocked@1 {achievement}` → `mod_bq.achievements(character_id, achievement_id,
  unlocked_seq)` (§5). Counters can be a projection or a small `mod_bq.achievement_progress` row.
- **Guardrails.** G1/G11 (client never asserts an unlock), G4 (unlock is an event), G9 (deterministic from the log).

### 4.g Chat & presence

- **[E]** a chat message channel + rate-limit/moderation seam (Custos, later). **[M]** nothing much — chat is a
  thin shared-world feature. **[E]** presence (other players populating areas) already works (synced players).
- **Intents (norma).** `chat {text}` — a **bounded string** (length-capped, rate-limited; the one place a client
  payload carries free text). This is **not** a G1 violation (it carries no amount/price/state), but it is the
  moderation surface: route through a profanity/rate filter; later consumed by Custos (moderation, NAMING.md §12).
- **Persistence.** Chat is ephemeral (not logged as truth), or logged low-fidelity for moderation only. A `chat`
  message fans out to the sender's area (Sector/AoI when that lands).
- **Guardrails.** G1 (text is content, not authority — never parsed for commands/privilege; G11), moderation is a
  reserved seam.

### 4.h Death / respawn UX + player persistence (BQ is famously light)

- **[E]** the respawn mechanic already exists (`ZoneRoom.onEntityKilled` respawns the player at a default spawn).
  **[M]** BQ's death *rules*: respawn at the nearest passed checkpoint (BQ has 24 checkpoints, 7 starting areas);
  classic BQ **keeps your gear** across death within a session (it is not a gear-loss roguelike) — death just
  returns you to a checkpoint with full HP.
- **BQ content.** Checkpoints/starting areas are map data → `content/zones/<area>/` metadata (`checkpoints:[...]`,
  `starting:true`). On death: reset `character_placement` to the last checkpoint, refill HP, emit `bq.player_died@1`
  (drives the `STILL_ALIVE` revive-count achievement).
- **Persistence (the light-persistence decision, §5).** Persist: the equipped loadout + inventory + achievements +
  placement. Do **not** persist mob/world state per-player (SHARED, rebuilt). Event-sourcing adds replay/audit the
  original never had, at no cost to BQ's feel. **Open question (§11):** does gear persist across *logout* (classic
  BQ: no, character is session-local by local-id) or across sessions (Celestia can, cheaply)? Recommend **persist
  across sessions** (the character already persists — CHARACTERS.md), as a strict, free improvement.
- **Guardrails.** G4 (death/respawn are events), G1 (server owns respawn position + HP), G9.

### 4.i World / area breadth (more zones) + the client HUD/UI layer

**World breadth [M].** BQ's world is one 172×314 map of **connected areas** (village, forest, caves, beach, desert,
lavaland, boss room) with 23 mob-spawn areas, 8 chest areas, 13 static chests, 84 doors, 15 music areas. On Celestia
this is **more Caelum zone JSON** (`content/zones/<area>/` with `mobs`/`chests`/`npcs`/`area` blocks and portals =
BQ doors), using the **existing** topology/portal/seat-reservation seam. The large single map can be one Zone with
Sector/AoI (WORLDS.md §7 — BQ's own "zone groups" are exactly the Sector concept, a seam not yet built) or split
into several portal-linked Zones; either is additive content, no engine change. Music areas = client-side `area`
metadata on the wire.

**Client HUD/UI layer [M], the biggest client gap.** The current client has only a one-line text HUD
(`setHud(text)`); a faithful BQ client needs a **DOM/overlay UI layer** (the Pictor single-string seam is
insufficient — confirmed by the client inventory). Net-new client UI, reading `World` fields/events:
- **Player health bar** (data exists: `World.selfHp/selfMaxHp`; needs a widget).
- **Inventory + equipment panel** (new `World` state from new synced components + a UI).
- **Chat window** (new `chat` channel + input/log UI).
- **Achievement toasts** (new unlock message + a transient notification UI).
- **NPC dialogue boxes / speech bubbles** (new `dialogue.line` message + bubble UI — BQ uses speech bubbles).
- Plus wiring the existing-but-unplayed **death animation** (rat already has a `death` sprite row) and loot/pickup
  affordances. These extend Pictor's `VisualSpec`/orchestrator + the asset manifest; the screen-space UI is a
  separate DOM overlay per web client (and Godot UI in astrolabe later).
- **Guardrails.** G1/G11 (client sends indices/ids/bounded chat text, never amounts or privilege; Jupiter's
  IntentSender refuses amount/price fields), G3 (art/render is module+client; the engine ferries `kind` opaquely).

---

## 5. Persistence model — event-sourced, and the "light persistence" feature

BrowserQuest is famously **light on persistence**: classic BQ keeps essentially nothing server-side — a character
and its gear live for a session (identified by a client-local id), and death drops you back to the start; the
**world** is the only durable thing. Celestia does not need to contradict that feel, and event-sourcing (G4) turns
"how much do we persist?" into a *dial*, not a rebuild. What BQ persists is deliberately minimal.

### 5.1 The three layers (same model as cozy, far less of it)

1. **Durable event log (truth) — [E].** Every BQ mutation is a `bq.*@1` event appended through `caps.events`
   (`EventSink`); the engine stamps `seq`/`prev_hash`/fence/actor, durable-before-ack (the existing
   `fornax/event-chain.ts` + `DurableEventSink`). Combat already emits events today; BQ adds `bq.item_looted@1`,
   `bq.item_equipped@1`, `bq.chest_opened@1`, `bq.item_used@1`, `bq.health_changed@1`, `bq.status_applied@1`,
   `bq.status_expired@1`, `bq.player_died@1`, `bq.achievement_unlocked@1`.
   This is the forever-compat surface (PLATFORM.md §6) — replay supports every historical `@version`; bumps are
   additive. **Free upgrade BQ never had:** the entire world's combat/loot history is replayable and audit-able.
2. **Engine-owned identity + placement — [E], already built.** `game_character` (the per-`(account_id, game_id)`
   save identity: id, account_id, name, status) and `character_placement` (zone_id, x, y, autosaved) exist today
   (CHARACTERS.md §9, migration `0002`). BQ reuses them verbatim; the engine `character` row stays genre-neutral —
   it knows `name`, nothing about swords or armor (G3).
3. **Module projection (`mod_bq.*`) — [M], minimal.** The small set of BQ-specific durable rows, a projection of
   the event log via pure reducers (never independent truth, G4), keyed by `character_id`:
   - `mod_bq.equipment(character_id, slot_id, item_kind)` — the equipped loadout as **slot-keyed rows** (one per
     occupied slot), not fixed weapon/armor columns. BQ fills `weapon`+`armor`; an RPG or cozy's tools fill more
     slots with **zero schema change** (§4.a).
   - `mod_bq.inventory(character_id, slot, item_kind, qty)` — carried items (potions, unequipped gear). BQ's
     inventory is tiny; a handful of slots.
   - `mod_bq.achievements(character_id, achievement_id, unlocked_seq)` — the unlocked set (BQ's achievements were
     client-local by design; Celestia makes them a durable per-character fact, server-authoritative — closes the
     classic "clear your cache, lose your achievements" hole).

### 5.2 What BQ deliberately does NOT persist (the design decision)

- **No economy / balances — [E] not built for BQ.** BQ loot is item drops, not currency; there is no ledger (G5
  not exercised, §8). `mod_bq` has **no money column** and never will — if BQ later adds gold, it routes through the
  EconomyService seam, not a plain number (§9.2 #13).
- **Death resets combat state, not identity.** On death BQ returns you to the start (`character_placement` reset to
  the spawn); the *equipment loadout* decision (keep vs drop on death) is a module rule in `execute` — classic BQ
  drops you to the default `clotharmor`/`sword1`; Celestia can honor that or soften it (an open question, §11).
- **No instanced/per-player world state.** The world's mobs/chests are SHARED zone state, rebuilt on room create
  from Caelum content + the respawn loop — not per-character saves. BQ needs none of cozy's instanced-room
  persistence or deterministic fast-forward (§9.2 #4).

### 5.3 GRANT discipline

`mod_bq` is its own Postgres schema with least-privilege GRANTs (PLATFORM.md §3.2 / PIPELINE.md §3 one-writer-per-
table): Atlas (the BQ module host) writes `mod_bq.*` + `log.event` + `character_placement`; it has **no** write
grant on `account`/`auth` (Polaris's lane). `(account_id, game_id)` composite-keys every per-player row so the
multi-game seam (PLATFORM.md §6) is additive, not a rework — reserved now, filled when game #2 lands (§9.2 #6).

---

## 6. Content pipeline — all new Caelum-validated JSON (mirrors `content/mobs.json`)

Every new BQ system is **data-driven through the `content/mobs.json` + `caelum.ts` pattern** (the canonical
content-driven pattern, already proven for the monster roster), registered via `ModuleRegistry.content(manifest)`
and **boot-validated** (Zod + cross-reference checks) so a dangling reference fails boot loudly — exactly as a
spawn for an unknown monster kind does today. **Adding BQ content = editing JSON, not code.**

### 6.1 The three-level layout (mirroring the mob pattern exactly)

The mob roster already demonstrates the three levels (confirmed from `content/mobs.json`, `config/world.json`,
`content/zones/verdant/zone.json`):

| Level | Pattern today (mobs) | BQ files to add |
|---|---|---|
| **Global roster** (kind → stats + sprite) | `content/mobs.json` | `content/bq/{items,equipment,statuses,npcs,chests,achievements}.json`; new BQ monster kinds **extend** `content/mobs.json` |
| **Per-zone placement / spawn table** | `content/zones/<id>/zone.json` `mobs:[...]` | add `chests:[...]`, `npcs:[...]`, `loot` overrides, area metadata to each zone; new `content/zones/<area>/` bundles for world breadth |
| **Global sim defaults** | `config/world.json` (`respawn`, `assets`) | `content/bq/combat.json` (damage-formula constants, potion heal amounts), loot-roll defaults — never bare literals in code (G8) |

### 6.2 Example shapes (mirroring the flat `{kind: {sprite, ...stats}}` shape of mobs.json)

These mirror `content/mobs.json`'s structure: a flat map keyed by the thing's id, value = `{sprite, ...gameplay
stats}`, **behavior is never a field** (mob/NPC behavior comes from Pallas seeded precedents, not JSON `if`s). The
exhaustive BQ rosters (full weapon/armor/mob/NPC/achievement lists) are enumerated in §4; the shapes are:

```jsonc
// content/bq/equipment.json — SLOT-GENERIC equippable gear. NOT "weapons"/"armor" top-level buckets:
// (1) the module declares its SLOT SET; (2) each item declares its `slot` + a generic `modifiers` stat-map
//     + a visual `layer`. Derived stats = base + Σ(equipped items' modifiers), aggregated generically by the
//     engine; the module formula (§4.a) maps the aggregate → the final combat number. Same BQ numbers.
{ "slots": ["weapon", "armor"],   // game-bq's slot set. An RPG: ["weapon","armor","shield","head","ring1","ring2","accessory"].
                                   //                      cozy: ["hoe","wateringCan","axe","pickaxe"] — just more slots.
  "items": {
    "sword1":      { "slot": "weapon", "rank": 0, "modifiers": { "weaponDamage": 1 }, "sprite": "sword1",      "layer": "overlay" },
    "sword2":      { "slot": "weapon", "rank": 1, "modifiers": { "weaponDamage": 2 }, "sprite": "sword2",      "layer": "overlay" },
    "axe":         { "slot": "weapon", "rank": 2, "modifiers": { "weaponDamage": 3 }, "sprite": "axe",         "layer": "overlay" },
    /* … morningstar(3,+4), bluesword(4,+5), redsword(5,+6), goldensword(6,+7) — full list in §4.a */
    "clotharmor":  { "slot": "armor",  "rank": 0, "modifiers": { "maxHp": 80  }, "sprite": "clotharmor",  "layer": "body" },
    "leatherarmor":{ "slot": "armor",  "rank": 1, "modifiers": { "maxHp": 110 }, "sprite": "leatherarmor", "layer": "body" },
    "mailarmor":   { "slot": "armor",  "rank": 2, "modifiers": { "maxHp": 140 }, "sprite": "mailarmor",    "layer": "body" }
    /* … platearmor(3,170), redarmor(4,200), goldenarmor(5,230); firefox = transient, unranked — full list in §4.a */ } }
// NOTE: armor's maxHp modifier IS BQ's maxHP=80+(armorLevel−1)×30 pre-computed per item; weaponDamage IS weaponLevel=rank+1.
// A future item can carry {maxHp:+30, defense:+2} with no schema change — modifiers is an open stat-map.
```

```jsonc
// content/bq/items.json — non-equipment items. A consumable declares `use.effects` over the §4.0 FIXED effect
// set — NO "potion"/"food" hardcoding; a heal item and a buff item differ only in their declared effects.
{ "items": {
    "flask":      { "sprite": "flask",      "stack": 99, "use": { "effects": [ { "heal": 40  } ] } },
    "burger":     { "sprite": "burger",     "stack": 99, "use": { "effects": [ { "heal": 100 } ] } },
    "cake":       { "sprite": "cake",       "stack": 99, "use": { "effects": [] } },              // cosmetic (unlocks FOR_SCIENCE)
    "firepotion": { "sprite": "firepotion", "stack": 99,
                    "use": { "effects": [ { "applyStatus": "invulnerable",  "ms": 15000 },
                                          { "applyStatus": "firefox_skin", "ms": 15000 } ] } } } }
```

```jsonc
// content/bq/statuses.json — the status/buff roster (§4.d.1). modifiers fold into the SAME aggregation as
// equipment (§4.a); flags are the FIXED condition vocabulary honored by core systems; stack = per-status policy.
{ "statuses": {
    "invulnerable":  { "flags": ["invulnerable"], "stack": "refresh" },           // §4.0 `damage` zeroes vs this
    "firefox_skin":  { "spriteLayer": { "slot": "armor", "kind": "firefox" }, "stack": "refresh" }, // cosmetic swap
    "regen":         { "tick": { "everyMs": 2000, "effect": { "heal": "maxHp/25" } }, "stack": "ignore" } } }
    // BQ ships ONLY these three. modifiers example (unused by BQ, shape only): "might": { "modifiers": { "weaponDamage": 2 } }
```

```jsonc
// content/mobs.json — EXTEND with BQ's full mob roster (reusing the EXACT existing stat schema;
// goblin/ogre/crab/snake/bat/eye/spectre/wizard/deathknight/skeleton2/boss). No code change to add one.
{ "mobs": {
    "goblin": { "sprite": "goblin", "level": 5, "maxHp": 90, "damage": 6, "radius": 10,
                "moveSpeed": 100, "aggroRange": 200, "attackRange": 42,
                "attackCooldownMs": 1100, "decisionIntervalMs": 500, "respawnDelayMs": 7000,
                "loot": [ { "item": "sword2", "chance": 0.05 }, { "item": "flask", "chance": 0.2 } ] } } }
```

```jsonc
// content/zones/<area>/zone.json — EXTEND the existing per-zone bundle (which already has id/name/tickHz/
// maxPerChannel/map/mobs[]) with BQ placement blocks. Boot-validated against the rosters above.
{ "id": "forest", "name": "The Dark Forest", "tickHz": 20, "maxPerChannel": 200, "map": "map.json",
  "mobs":   [ { "kind": "goblin", "at": { "x": 120, "y": 64 } } ],
  "chests": [ { "at": { "x": 200, "y": 96 }, "loot": [ { "item": "leatherarmor", "chance": 1 } ] } ],
  "npcs":   [ { "kind": "guard", "at": { "x": 48, "y": 48 } } ],
  "area":   { "music": "forest", "pvp": false } }
```

```jsonc
// content/bq/npcs.json — NPC roster + dialogue. Scripted lines are content; Pallas-flavored lines are a later
// decision (§4). `lines` is the scripted fallback; `schema` (optional) names a Pallas decision schema.
{ "npcs": {
    "guard": { "sprite": "guard", "lines": ["You can't go there.", "The forest is dangerous."] },
    "king":  { "sprite": "king",  "lines": ["Welcome, hero."] } } }
```

```jsonc
// content/bq/achievements.json — achievement roster + machine-readable trigger (observed over the event stream).
{ "achievements": {
    "first_blood":  { "name": "A Troll Story", "desc": "Kill your first mob",
                      "trigger": { "event": "bq.player_killed_mob", "count": 1 } },
    "well_armed":   { "name": "Well Armed",    "desc": "Equip a level-7 weapon",
                      "trigger": { "event": "bq.item_equipped", "where": { "slot": "weapon", "rank": 6 } } } } }
```

### 6.3 Boot-validation extensions (Caelum, same loud-fail discipline)

Caelum (`packages/firmament/src/caelum`) already Zod-parses and cross-checks the world graph at boot; BQ extends it:
every mob/chest `loot` item ∈ `items.json` ∪ `equipment.json`; every zone `npcs[].kind` ∈ `npcs.json`; every
achievement `trigger.event` is a declared `bq.*@1` event type; every equipment entry's `sprite` is in the asset
manifest; every equipment item declares a `slot` ∈ the declared slot set; every item `use.effects[*]` names a verb
in the §4.0 **fixed effect set** and every `applyStatus` references a status ∈ `statuses.json`; every status's
`flags` ∈ the fixed condition vocabulary and its `stack` ∈ `{stack,refresh,strongest,ignore}`. A dangling reference
or an unknown effect/flag → **boot failure**, never a silent runtime surprise — the invariant Caelum already
enforces for mobs. (This is how the "fixed vocabulary, not a DSL" discipline is mechanically enforced: an
undeclared effect verb or flag cannot load.)

---

## 7. Phased roadmap — core first, then additive mechanics in flexible order

**The only hard ordering is: the CORE comes first** (P0 extraction + the generic deep-seam shapes). After that,
mechanics are **additive and their order is flexible** — chosen by value/cost, not genre (§0.3). The sequence below
front-loads the **combat cluster** (P1) purely because it is ~80% already built (§2); it is **not** a claim that
farming must wait. Each phase has a definition-of-done (DoD).

> **Mechanic order is a dial, not a dependency chain.** Once P0 + the inventory/content pipeline (early P1) exist,
> any mechanic that rides *store + content + inventory + a seeded `execute`* can be pulled forward. Concretely:
> **crops/farming can be interleaved with the combat phases** — a crop (`till`→`plant`→`water`→`harvest`→yield into
> inventory) is the same machinery as loot (kill→drop→`loot`→item into inventory), so it can land in P1/P2 beside
> equipment rather than "after BrowserQuest is done." What genuinely *gates* the farming-heavy mechanics is only the
> **deep seams** — a slow world-clock tick (for day/season), the instanced-room lifecycle (for private farms), and
> the EconomyService (for a coin economy/shops) — and those have their **generic shape laid at P0** (§9.2) so the
> farming mechanics can arrive on the user's schedule. The phases below are therefore one *recommended* value/cost
> ordering of the single evolving module, not a fixed pipeline.

### 7.1 Phases

**Phase 0 — Engine↔module extraction (THE PROOF). No new gameplay.** *Engine + packaging work.*
- `@celestia/game-contract` (interfaces + leaf types) + the engine/`@celestia/game-bq` package split;
  `dependency-cruiser` arch-test (engine ↛ game-\*, G3). Move the extraction manifest (§3.2) out of Atlas; keep the
  generic engine (§3.3) in place. `engine.mount(cfg.game.driver='bq')` replaces the hardcoded room `define`.
- Lay the **deep-seam shapes generically** (§9.2): full Worked-B `GameModule`/`ModuleRegistry`/`RoomCaps` interface
  (BQ stubs the Match half); per-room-type tick driver (`tick:{kind:'interval',hz}` — promote `tickHz:20`); the
  instanced-room *lifecycle hooks* wired to BQ's shared static zones; `game_id` first-class in `allow()` + the
  `mod_bq` schema seam; keep the single-writer fence in the pipeline.
- Write the **CTK** (PLATFORM.md §6) and run it in CI against `@celestia/game-bq`.
- **DoD:** the entire current POC plays unchanged *as* a module (login → zone → move → attack → mob AI → respawn,
  all existing tests green); CTK green; arch-test red on an engine→game edge; `engine.mount('bq')` is the only place
  a concrete module is named. (Full DoD in §3.6.)

**Phase 1 — Combat depth: items, equipment, loot, chests, consumables (THE FIRST REAL GAMEPLAY).** *Module content.*
- `content/bq/{equipment,items,statuses}.json` + extend `content/mobs.json` with the full 13-mob roster + per-mob
  `loot` tables; Caelum boot-validation extensions (§6.3). New components `health{hp,maxHp}`, `equipment{slots}`
  (the slot-generic slot→item map, §4.a), `inventory`, `statuses{list}` (§4.d.1), `groundItem`, `chest`. Build the
  §4.0 **unified mechanism** (depletable pool + fixed effect set + `rollDrop`→inventory) + the §4.a **modifier
  aggregation** (equipment + statuses, one fold) + the module combat formula + armor-derived max-HP. The
  `StatusSystem` + `RegenSystem` on `caps.timer` (its first real consumer, §9.2 #14; regen = a periodic status).
  New actions `loot`, `equip`/`unequip`, `use_item`, `open_chest` (§4.a–d.1). BQ statuses: `invulnerable`,
  `firefox_skin`, `regen` only.
- **DoD:** kill a skeleton → `rollDrop` → walk/click to `loot` → `equip` a better sword/armor → sprite **and**
  max-HP change (server-computed via aggregation) → drink a `flask` (`heal` effect) → quaff a `firepotion` →
  `invulnerable` status zeroes incoming damage for 15 s then expires (event-sourced, server-side) → open a chest for
  a random item; a chest-area clears and spawns its reward chest; all damage/drops/status windows are seeded +
  event-sourced (replay reproduces them, byte-identical); **no client-sent number anywhere** (G1 grep clean); the
  rank-gate is enforced server-side.

**Phase 2 — The living world: NPCs + scripted dialogue + chat + the client UI layer.** *Module content + client.*
- `content/bq/npcs.json` (scripted `lines`) + the `npc` archetype + the `talk` action + a `MSG.dialogue` channel
  (§4.e). `chat {text}` bounded-string channel + rate-limit (§4.g). The **client DOM/overlay UI layer** (§4.i):
  player health-bar widget, inventory/equipment panel, NPC speech bubbles, chat window — reading `World`
  fields/events. Death animation wiring (rat already has the sprite row).
- **DoD:** talk to the king/guard/rick and see cycling speech bubbles; chat appears to nearby players; the player
  health bar, inventory, and equipped gear render in a real UI; dialogue is scripted content (no model dependency).

**Phase 3 — Achievements + world breadth + death/checkpoints.** *Module content + a server detector.*
- `content/bq/achievements.json` (the 20 BQ achievements) + the server-side `AchievementSystem` (observes the event
  stream, server-authoritative, no client trust) + achievement-toast UI. More Caelum zones/areas
  (`content/zones/<area>/`: forest/caves/beach/desert/lavaland/boss) with mob/chest/npc placements + portals (BQ
  doors) + music-area metadata. Checkpoints + BQ's respawn-at-checkpoint rule (§4.h).
- **DoD:** the full BQ area set is traversable via portals; killing mobs/looting/talking unlocks the right
  achievements with toasts (kill-count, loot-type, and geofenced ones evaluated server-side); death returns the
  player to the nearest checkpoint with gear kept; achievements persist across sessions.

**Phase 4 — Optional upgrades (engine-reuse demonstrations, not BQ requirements).**
- Pallas-flavored NPC dialogue (route `talk` through `buildDialogueRequest`/`onDialogueIntents`, S2/Calliope when
  the model is wired — candidate lines re-validated, G2). Sector/AoI interest management (WORLDS.md §7 — BQ's "zone
  groups") when a zone gets crowded. The Godot/astrolabe client over the same Jupiter/norma contract.
- **DoD:** each is additive and independently shippable; none re-opens a seam.

### 7.2 Engine primitives scheduled per phase (and which cozy depends on)

| Engine primitive | Built in | Cozy (game #2) reuses it for |
|---|---|---|
| `GameModule`/`ModuleRegistry`/`RoomCaps` contract + `engine.mount` + arch-test + CTK | **P0** | the entire module boundary (COZY §4.0) — **zero rework** |
| Per-room-type tick driver (`tick:{interval,hz}`) | **P0** | the slow ~1 Hz town vs 20 Hz farm (COZY §5) |
| Instanced-room lifecycle *hooks* (shape only; BQ uses shared zones) | **P0** | `joinOrCreate(ranchId)` + load/fast-forward/dispose (COZY §6) |
| `game_id` first-class in `allow()` + per-module schema (`mod_bq`) | **P0/P1** | cross-game isolation + `mod_cozy` (COZY §7, PLATFORM §6) |
| Single-writer fence (kept in the pipeline) | **P0** | SHARED-resource writes; the precondition for custody/escrow (COZY §4.m) |
| `caps.timer` (deterministic event-time timers) | **P1** | crop/animal day-ticks, festival windows, ship-bin settle (COZY §4) |
| Seeded `caps.rng` event-sourced into the log (combat/loot) | **P1** | weather, crop quality, forage/ore/loot rolls — the fast-forward linchpin (COZY §5.1) |
| EconomyService (`caps.ledger`) | **NOT built for BQ** (§8) | cozy builds it as its first consumer (COZY §4.f) — BQ only avoids contradicting G5 (§9.2 #13) |
| Custody + escrow saga; Match/turn barrier; `viewFilter` | **shape reserved, not built** (§9.2 #15-16) | cozy's trade/co-op (thin), a future Pokémon-like (full) |

---

## 8. Guardrail compliance

| G | Rule | How the BQ plan complies |
|---|---|---|
| **G1** | client never trusted; intents carry indices/ids, never amounts/prices/state | Every BQ intent is `{targetId}` or `{slot}`/`{optionIndex}` (§4). The server `enumerate()`s legal targets and **computes every number** — damage (`dmg = wLvl×rnd(5,10) − aLvl×rnd(1,3)`), drops, heals, max-HP. No stat/HP/damage/item-kind/quantity field ever crosses the wire; `equip`/`loot`/`use_item` send a slot or target, the server reads the item from authoritative state. Jupiter's IntentSender refuses `amount`/`price` fields. BQ's original client-authoritative combat is **dropped** (§2.1). A numeric stat/damage field on any BQ intent is a finding. |
| **G2** | the LLM never writes state | Mob AI returns an **index** into the sim-authored `mob.tactic` label set; the room re-`enumerate`s + re-runs `allow()` as `actor=sim` before dispatching `attack` (already the POC behavior). If/when Pallas-flavored NPC dialogue (S2) lands (P4), candidate lines are re-validated and the model holds **zero** grant on state. Behavior is seeded precedents, not a live model for basic AI (MEMORY). |
| **G3** | engine ↛ game module | `@celestia/game-bq` imports the engine; the engine **never** imports it (`dependency-cruiser` red on violation, P0). The extraction (§3.2) moves every BQ noun (attack, mob labels, player stats, component field sets, item/equipment/loot/npc/achievement content) into the module; the engine ferries `kind`→sprite **opaquely** (the engine never learns what a sword or a rat looks like). The `fornax/index.ts` re-export of concrete actions is broken. |
| **G4** | event-sourced truth | Every BQ mutation is an append-only `bq.*@1` event (combat exists; §5 adds loot/equip/chest/use/death/achievement) with a pure `apply()` reducer, `seq`/`prev_hash`-chained, durable-before-ack (the existing `fornax/event-chain.ts` + `DurableEventSink`). Replay reproduces combat/loot/achievements byte-identically (free anti-cheat). The signal bus is live-only, never the log. |
| **G5** | one EconomyService chokepoint, integer money | **Not exercised by BQ** — BQ's loot is drop-based, not a currency economy; there is no ledger and no money anywhere (§5.2). The plan **does not build Moneta for BQ** (YAGNI) but **does not contradict the seam**: if BQ ever adds gold it routes through the EconomyService from day one, never a plain `gold:number` (§9.2 #13). Cozy builds the ledger as its first consumer (COZY §4.f). CTK asserts "fungible value only via LedgerHandle" trivially (BQ makes no value move). |
| **G6** | `allow()` deny-by-default before enumerate/execute | Every mutating BQ action passes `allow(actor, authzClass, resource, ctx)` first (the existing Fornax `allow`/`Astraea` stage); `resolveResource` reads owner/scope from authoritative state, never the client envelope. A SHARED ground item/chest is single-writer-fenced so two players can't both loot it. `ctx.gameId='bq'` denies any foreign-game resource (P0/P1). Unknown action → deny (already enforced). |
| **G7** | ports/adapters | Concrete adapters (`DurableEventSink`, `PgPrecedents`, `KyselyRepository`) are named only at the composition root / via `ZoneRoomDeps` factories (confirmed already the pattern); callers depend on ports (`EventSink`, `PrecedentStore`, `Repository`). The extraction preserves this — the module gets `RoomCaps` handles, never a concrete. |
| **G8** | no secrets in code | Unchanged; config via the firmament Zod loader. Every BQ tunable (damage ranges, drop %, heal amounts, respawn/despawn ms, HP formula constants, max-HP table) is **content/config** (§6), never an inline literal. |
| **G9** | determinism; seeded RNG; no wall-clock in sim | All BQ randomness — damage rolls, drop rolls, chest picks, mob scatter/respawn placement — uses `caps.rng` seeded from the current event (the POC already seeds mob scatter via mulberry32); timers key to event-time (`ZoneState.t`), not wall-clock. Replay is byte-identical (the basis of §4's "free anti-cheat"). |
| **G10** | naming/structure; celestial codenames | `services/` not `apps/`; no `-server` suffix. The module is `@celestia/game-bq` (PLATFORM-fixed) with codename **Perseus** (proposal, §10); BQ needs no new engine subsystem codename. Wire constants live in `@celestia/norma`. |
| **G11** | client never sets its own privilege | Identity/role arrive on the Polaris-signed badge (`ZoneSeatAuth` → `client.auth`), never a client claim; `onAuth` is skipped only for a reserved seat. **Achievements are server-detected, never client-asserted** (closing BQ's client-side unlock/spoof hole, §4.f); `chat` text is content, never parsed for privilege/commands; the rank-gate and all progression are server-authoritative. |

---

## 9. BQ → cozy incremental growth path — additive vs generic-early (the crux)

The user's intent is to **grow BrowserQuest into the cozy life-sim by introducing the cozy-needed primitives
gradually during BQ development**, rather than building two games in parallel. That is exactly right *if and only
if* we respect one distinction, which is the whole game here:

- **ADDITIVE** capabilities can be bolted on at any time with **no TCB surgery** — they are new content, new
  components/systems, new actions/events, or a new standalone service that nothing else has to be re-opened to
  accommodate. Introduce them at the first moment a game actually needs them. The entire BQ gap list (items/
  equipment, loot/chests, consumables, NPCs/dialogue, achievements) is additive, and so are **cozy's later content
  packs** (crops/animals/recipes/villagers) because they ride the **same content-driven Caelum pattern** (§6) and
  the same `declare()`/ECS/pipeline seams BQ already exercises. Adding them is editing JSON + registering
  components/actions — never engine surgery.
- **FOUNDATIONAL / deep seams** touch the **room TCB, the intent-pipeline stage order, clock authority, and the
  single-writer invariant.** Retrofitting one of these *after BQ is live with real users and persistent data* is
  PLATFORM.md's explicit nightmare: *"add later = re-opening the TCB in production."* These must have their
  **generic shape laid early (P0/P1)**, even if BQ's usage of them is thin or stubbed, so that later consumers
  (more of BQ, then cozy) *fill in a reserved hook* instead of re-cutting a seam.

### 9.1 The timing point — we are at the cheapest possible moment

**Right now Celestia is pre-production: nothing is committed, there are no live users, and there is no persistent
player data.** The PLATFORM.md warning ("re-opening the TCB in production") only *bites* once BQ is shipped to real
users against a durable log. So **this is the cheapest moment in the project's entire life to lay the deep seams.**
The recommendation follows directly:

1. **Lay the deep-seam *shapes* generically during P0/P1 while it is free** — the full `GameModule`/`ModuleRegistry`/
   `RoomCaps` contract (Worked-B shape), a per-room-type tick driver (not a single hardcoded global tick), the
   instanced-room lifecycle *hooks* (`onRoomCreate`/`onJoin`/`onLeave`/`onRoomDispose` + a `joinOrCreate(id)`
   resolution seam) even if BQ only ever uses shared static zones, and the single-writer + `game_id`-scope
   invariants in the pipeline.
2. **Introduce each primitive at the first BQ moment that gives it even a thin consumer** (PLATFORM.md's "justify
   each primitive by a credible consumer" rule — avoid building pure hypotheticals). A thin consumer is enough to
   keep the shape honest and CTK-tested.
3. **Grow everything else additively**, exactly when the game needs it.

### 9.2 The ordered table — primitive → additive/foundational → first justifying BQ feature → shape-early-or-defer

Legend: **[E]** engine-primitive · **[M]** module. "Shape early" = lay the generic interface/stage now (P0/P1) even
if thin; "Add when needed" = pure additive, introduce at the feature; "Defer" = no BQ consumer, don't build, but do
not contradict its seam.

| # | Primitive / capability | [E/M] | Additive or FOUNDATIONAL | First BQ feature that justifies it (thin consumer) | Verdict |
|---|---|---|---|---|---|
| 1 | **`GameModule` + `ModuleRegistry` + `RoomCaps` contract** (full Worked-B shape) | [E] | **FOUNDATIONAL** (the seam itself) | the P0 extraction — the whole POC mounts as a module | **Shape early — P0.** Build the full-shape interface; BQ stubs the Match/custody/viewFilter hooks. |
| 2 | **`engine.mount(cfg.game.driver)` composition root** + dependency-cruiser arch-test (engine ↛ game-\*) | [E] | **FOUNDATIONAL** | P0 — replaces hardcoded `gameServer.define("zone")` | **Shape early — P0.** Red CI on any engine→game edge (G3). |
| 3 | **Per-room-type tick driver** (`tick:{kind:'interval',hz}` as a room-type property, not a single global tick) | [E] | **FOUNDATIONAL** (clock authority) | P0 — BQ zones already carry per-zone `tickHz:20`; promote it to the room-type registry | **Shape early — P0.** BQ only uses one `interval` value; cozy's slow town + 20 Hz farm reuse the seam with zero surgery. |
| 4 | **Instanced-room lifecycle hooks** (`onRoomCreate`/`onJoin`/`onLeave`/`onRoomDispose` + a `joinOrCreate(id)` resolution seam) | [E] | **FOUNDATIONAL** (room TCB) | P0 — the hooks exist in the contract; BQ wires them to its **shared static zones** (room id = zone id, persistent-pinned) | **Shape early — P0 (hooks) / behavior deferred.** Lay the lifecycle *shape* and the keyed-join seam (BQ's area-crossing already uses seat-reservation); do NOT build player-instancing machinery (no BQ consumer). Cozy's `joinOrCreate(ranchId)` + load/fast-forward/dispose fills the reserved hooks. |
| 5 | **Single-writer fence per SHARED resource** (`holdsFence` before `execute`) | [E] | **FOUNDATIONAL** (single-writer invariant) | already present in Fornax; BQ's shared mobs/chests exercise it | **Shape early — P0 (verify, don't contradict).** Already built; the extraction must keep it a pipeline stage. The invariant that later makes custody/escrow possible must never be violated by a BQ shortcut. |
| 6 | **`game_id` first-class in `allow()`** + `(account_id, game_id)` save key + `mod_bq` schema namespace | [E] | **FOUNDATIONAL** (cross-game isolation) | P0/P1 — the module boundary + any BQ persistence (§5) | **Shape early — P0/P1.** Cheap now, defense-in-depth per PLATFORM.md §6; a co-location decision later cannot silently defeat isolation. |
| 7 | **Items / inventory / SLOT-GENERIC equipment** (generic slot-map component + `equip`/`unequip` + slot-fit/rank validation + additive modifier aggregation = [E]; slot set + stat set + item roster + formula = [M]) | [E]+[M] | **ADDITIVE** (the module half) but the generic **slot-map + aggregation** is a reusable **[E] primitive** | P1 — BQ's weapon/armor are the first two slots | **Add at P1; build the equipment mechanism GENERICALLY.** BQ declares 2 slots; because the component is a `slot→item` map + a flat `modifiers` fold, an RPG's extra slots and **cozy's Stardew tools (§10) are the SAME system** — zero rework. Right-sized: slots + additive modifiers + a module formula, no buff/enchant engine (YAGNI). |
| 8 | **Loot drops + chests** (ground-item entity, drop tables) | [M] | **ADDITIVE** | P1 — kill a mob, it drops gear; chests | **Add when needed — P1.** |
| 9 | **Consumables (item use-effects) + status/buff system** (`use_item` over the §4.0 fixed effect set; `statuses` component + timer expiry/tick + fixed flag vocab; buff modifiers fold into the §4.a aggregation) | [E]+[M] | **ADDITIVE** (BQ's items/statuses) but the generic **effect set + status shape** is a reusable **[E] primitive** | P1 — flask/burger heal; firepotion `invulnerable`; out-of-combat regen | **Add at P1; build GENERICALLY.** BQ ships only `invulnerable` + `regen`; the skill/buff *shape* (pools + fixed effects + fixed target-shapes + fixed flags + cooldown-via-timer, §10) is designed now so cozy tool/food buffs + a future RPG's spells slot in as content. YAGNI: fixed vocabularies, no status/skill DSL. |
| 10 | **NPCs + dialogue** (scripted first, Pallas-flavored later) | [M] | **ADDITIVE** | P2 | **Add when needed — P2.** Reuses the Pallas spine [E] that already exists for mobs. |
| 11 | **Achievements** (event-observing detector) | [M] | **ADDITIVE** | P3 | **Add when needed — P3.** Pure observer over the existing event stream (G4) — no new seam. |
| 12 | **World / area breadth** (more zones) | [M] | **ADDITIVE** | P3 | **Add when needed — P3.** More Caelum zone JSON; the topology seam exists. |
| 13 | **EconomyService / Moneta** (`caps.ledger`, integer money, `economy.posted@N`) | [E] | **Mostly ADDITIVE service, but G5-disciplined** | **no true BQ consumer** (BQ loot is drop-based, not currency). *If* BQ ever adds "gold," that is the thin consumer. | **Defer the service — but DO NOT contradict G5.** If BQ introduces any currency, route it through the EconomyService seam **from day one** (never a plain `gold:number` on a component or an `amount` on an intent), else you buy a G5 retrofit across live data. Cozy builds Moneta for real (COZY-MMO-PLAN.md §4.f). |
| 14 | **`caps.timer`** (deterministic event-time per-instance timers) | [E] | **ADDITIVE-ish** | P1 — mob **respawn** (today a `respawnDelayMs` loop) is a credible first consumer; BQ potion cooldowns | **Shape early-ish — P1.** A clean home for the respawn/cooldown timers BQ already needs; cozy reuses it for crop/animal/festival timers. Low cost, real BQ consumer. |
| 15 | **Custody + `escrowSwap` saga** (owned-asset transfer, two-phase trade) | [E] | **FOUNDATIONAL** (hardest correctness surface) but **no BQ consumer** | none in BQ (no trade; BQ gear is not traded) | **Defer the machinery — but keep the single-writer discipline (#5) uncontradicted.** Building escrow with no consumer = PLATFORM.md's over-generalization anti-pattern. Cozy's synchronous trade is the real exercise (COZY-MMO-PLAN.md §4.m, PLATFORM.md Risk 3). BQ's job is only to not make it *impossible* later — which #5 guarantees. |
| 16 | **Sealed-commit turn barrier** + **per-seat `viewFilter`** + **`MatchRoom`** | [E] | **FOUNDATIONAL** but **no BQ or cozy-launch consumer** | none (BQ is real-time open-world; cozy uses only thin forms) | **Reserve the hook shape (contract only); defer the machinery.** The `GameModule` interface carries `isTurnComplete`/`resolveTurn`/`viewFilter` (so the CTK can assert a module *could* express a Match), BQ stubs them, and the `MatchRoom` sibling is built when the first *real* phase-gated consumer exists (PLATFORM.md's Pokémon-like, or a cozy co-op minigame). Laying the `CelestiaRoom`→`Zone`/`Match` *base-class split* is cheap and worth doing at P0 (#1); the barrier/timer/result machinery is not. |

### 9.3 The one-line rule

**Shape the four deep seams generically at P0/P1 while it is free (contract #1-2, tick driver #3, room-lifecycle
hooks #4, single-writer + `game_id` #5-6); build everything else additively at the first feature that needs it; and
never contradict the EconomyService (#13) or single-writer/custody (#5/#15) invariants even where BQ has no consumer
yet.** That is precisely PLATFORM.md §7.1's "guiding cut" — build what a *committed* consumer forces, refuse
generality whose only customer is hypothetical — applied to the BQ→cozy growth path, and it is only cheap because we
are doing it **before** BQ goes live.

---

## 10. How this de-risks cozy (what BQ proves that cozy reuses, and what cozy must still add)

BQ is the engine-extraction vehicle; cozy (COZY-MMO-PLAN.md) is the first game that must land on the extracted
engine with **no surgery**. This is the proof ledger: each row is a capability BQ exercises for real, what cozy
inherits, and what cozy still has to build on top.

| Capability | BQ proves it by… | Cozy reuses… | Cozy must still ADD |
|---|---|---|---|
| **`GameModule`/`ModuleRegistry`/`RoomCaps` contract** | shipping the whole POC as a module behind it (P0) | the contract verbatim + the CTK | its own `declare()` content (crops/villagers/economy) |
| **Engine↔module split + arch-test + composition root** | `engine.mount('bq')`, engine ↛ game-bq red CI | `engine.mount('cozy')` — same seam | nothing (pure reuse) |
| **The action pipeline** (`enumerate→allow→qualify→execute→event→signal`) | every BQ verb (attack/loot/equip/use/open) as new data in the same stages | the pipeline wholesale | its farming/social verbs as new `ActionDef`s |
| **Per-room-type tick driver** | promoting `tickHz:20` to a room-type property | the driver seam | the **slow ~1 Hz town** value + a world-clock reducer |
| **Instanced-room lifecycle *hooks*** | wiring them to shared static zones (shape only) | the reserved hooks | the **real** `joinOrCreate(ranchId)` + load/**deterministic fast-forward**/dispose |
| **Seeded RNG event-sourced into the log** | combat/loot/respawn rolls replay byte-identically | the determinism guarantee | weather/crop-quality/forage seeding — the **offline fast-forward linchpin** |
| **`caps.timer` (event-time)** | item despawn + potion/respawn cooldowns | the timer wheel | crop/animal day-ticks, festival windows, ship-bin settle |
| **Pallas decision spine** | mob AI (perceive→precedent→act→re-validate) | the whole spine | villager gift/schedule/converse decision schemas + seeds |
| **Event-sourced persistence + pure reducers** | BQ's `bq.*@1` events + replay | `EventSink`/chain/replay | its `cozy.*@1` events + checkpointing for long dormancy |
| **Content-driven Caelum pattern** | items/equipment/npcs/achievements as boot-validated JSON | the pattern + boot-validation | crops/recipes/animals/calendar/weather/shops manifests |
| **SLOT-GENERIC equipment** (slot-map component + equip/unequip + slot-fit/rank validation + additive modifier aggregation) | BQ's weapon/armor are 2 slots with `damage`/`maxHp` modifiers + a module formula | the **entire mechanism** — slot-map, aggregation, equip actions, sprite-layer compositing | only its **slot set + stat set + item roster** (`["hoe","wateringCan","axe","pickaxe"]` with tier/stats) |
| **`game_id` isolation + per-module schema** | `mod_bq` + `ctx.gameId='bq'` | the isolation dimension | `mod_cozy` rows + `(account_id,game_id)` save keys |
| **Single-writer fence (SHARED writes)** | two players can't both loot one ground item | the invariant (precondition for custody) | the **custody + escrow saga** (its real consumer) |
| **EconomyService (`caps.ledger`)** | **BQ does NOT build it** — only avoids contradicting G5 | the *uncontradicted* seam | **the ledger itself** (Moneta) as cozy's first consumer |
| **Match/turn barrier + `viewFilter`** | **BQ stubs them** (shape reserved in the contract) | the reserved hook shape | thin forms (trade-confirm, co-op redaction) |

**Cozy's tools ARE BQ's equipment system (a concrete payoff of generalizing now).** A Stardew tool — a hoe,
watering-can, axe, pickaxe, with upgrade tiers — is exactly *equipment in a tool slot that (a) gates/empowers an
action (`till` needs a hoe; a copper→iron→gold hoe tills a wider area) and (b) carries tier/stat modifiers.* Because
BQ builds the slot-map + additive-modifier + equip mechanism **generically** (§4.a), cozy's tools + upgrades are a
new **slot set** (`["hoe","wateringCan","axe","pickaxe"]`) + content, with **zero engine rework** — and the
`qualify()` "which tool is equipped?" check for a farming action reuses BQ's equip/slot-fit validation. Generalizing
equipment for BQ is therefore not speculative: it is directly cashed by cozy.

**Cozy's mine + harvest ARE BQ's combat machinery (the unified action shape, §4.0).** Because attack is factored
into a generic *depletable-pool + fixed-effect-set + `rollDrop`→inventory* mechanism, cozy's mine is "combat pointed
at an ore node" (pool = `durability`, tool = pickaxe, table = ore) and cozy's crop harvest is the same with pool =
`ripeness` and a single-item yield. BQ builds the gather/loot engine once; cozy's mining and harvesting are a thin
`ActionDef` + content tables, **no new gather engine** — exactly why COZY-MMO-PLAN.md §4.l calls the mine "mostly
reuse." The `health`/`durability`/`ripeness` pool shape and the one drop-roll→inventory path are shared across all
three games' gathering loops.

| Capability (added rows for the two generalizations) | BQ proves it by… | Cozy reuses… | Cozy must still ADD |
|---|---|---|---|
| **Unified depletable-pool + fixed-effect-set + drop-roll (§4.0)** | attack reduces mob `hp` → `rollDrop` → inventory | the pool component, the effect set, the one drop→inventory path | `mine`/`harvest` `ActionDef`s + ore/crop yield tables (content) |

**The full buff/skill pattern — the cross-cutting engine shape designed now, barely used by BQ.** The equipment
(§4.a), effects (§4.0), and status (§4.d.1) pieces compose into the generic pattern every action-RPG / cozy / a
future RPG-or-Pokémon reuses, so it is worth naming once:

- **A *skill* is a parameterized action:** a `cost` drawn from a depletable pool (HP/mana/stamina — §4.0 pool), a
  **fixed target-shape** (self / single / area / line — a short closed vocabulary, NOT arbitrary geometry), the
  **fixed effect set** it emits (§4.0: damage/heal/applyStatus/…), and a **cooldown** via `caps.timer`. BQ's
  `attack` and `use_item` are the degenerate cases (no cost, single/self target).
- **A *buff/debuff* is a status** (§4.d.1): temporary modifiers that fold into the one aggregation + fixed-vocab
  flags, expired/ticked on `caps.timer`.
- **What BQ actually builds:** consumables (use-effects) + exactly two statuses (`invulnerable`, `regen`). It does
  **not** build a skill/cost/target-shape system (no BQ consumer). But because the *shape* — pools, fixed effects,
  fixed target shapes, fixed flags, statuses, cooldown-via-timer — is designed now, **cozy's tool-buffs/food-buffs
  and a future game's spells/abilities slot in as content + thin `ActionDef`s with zero engine rework**.
- **YAGNI (the hard line).** Fixed vocabularies — **effects, condition flags, target shapes** — never a status/
  skill **scripting DSL** or conditional-trigger rules engine. Data-compose from the fixed sets; drop to code only
  for a genuinely novel mechanic; promote a repeated pattern to a new fixed-vocab entry only on the **rule of
  three** (a third real consumer), per PLATFORM.md §7.1's guiding cut.

**The honest limit of BQ's de-risking (the central warning, restated):** BQ exercises the *structural* seams
(contract, pipeline, tick driver, determinism, event-sourcing, content pattern, isolation) but **not** the
*hardest correctness surface* — the EconomyService ledger, owned-asset custody, and the escrow saga spanning them
(PLATFORM.md §7.2 Risk 3). Those get **zero** exercise from BQ. The mitigation is exactly PLATFORM.md's: lay their
*shape* in the contract now (so adding them is filling hooks), build the single-writer discipline that makes them
possible (BQ does), and **build + exercise the ledger/custody/escrow machinery during cozy** with cozy's own
synchronous-trade property-test harness. BQ's job is to make them *possible later*, not to prove them. Anyone who
reads "BQ proved the engine" as "the engine is done" has walked into Risk 1 — BQ proves the *genre-neutral
structural* engine; the value-movement engine is cozy's to prove.

---

## 11. Open questions / decisions needed

1. **Codename ratification (§0 header).** Lock **Perseus** for `@celestia/game-bq`, or pick **Orion** (the
   sword-bearing Hunter — arguably the better melee-combat emblem), **Draco**, or **Hydra**. (NAMING.md "menu, not
   a verdict"; run the npm/trademark clearance for whichever is chosen.)
2. **Gear persistence across logout.** Classic BQ characters are session-local (identified by a client local id);
   gear does not survive logout. Celestia's `game_character` already persists (CHARACTERS.md). **Recommend: persist
   the equipped loadout + inventory + achievements across sessions** — a strict, free improvement over the original,
   with no feel cost. Confirm (vs. deliberately replicating BQ's throwaway characters for fidelity).
3. **NPC dialogue: scripted vs Pallas for launch.** The plan recommends **scripted static dialogue for launch**
   (faithful to BQ, zero model dependency — §4.e) with Pallas-flavored S2 dialogue as an optional P4 engine-reuse
   demo. Confirm scripted-first.
4. **World topology: one big Zone + Sector/AoI, or several portal-linked Zones.** BQ is one 172×314 map with
   internal "zone groups" (= the Sector/AoI concept, a WORLDS.md §7 seam not yet built). Decide: ship the world as
   several portal-linked Caelum Zones first (uses the existing portal seam, no AoI needed at POC scale) and build
   Sector/AoI only when a single zone gets crowded — **recommended**; or build AoI up front to host one giant map.
5. **Client UI layer home.** The faithful BQ HUD (health bar, inventory, equipment, chat, dialogue bubbles, toasts)
   does **not** fit the current single-string `setHud(text)` seam (§4.i). Decide: a **DOM/overlay layer per web
   client** (fastest, matches the original's HTML UI) vs. a richer Pictor HUD contract vs. deferring the full UI to
   the Godot/astrolabe destination client. Recommend a DOM overlay for the web POC + Godot UI later.
6. **Equipment sprite representation.** BQ composites a full-body **armor sprite** (the player sprite *is* the armor
   kind) + a **weapon overlay**. The current client maps a single `kind`→sprite. Decide the layering model (armor =
   full sprite swap, weapon = overlay) — matches BQ and keeps `kind`→sprite opaque to the server (G3).
7. **Keep or drop the `lever`/`interact` action.** It has no BQ consumer (the POC's lever is already unplaced). Keep
   it as the generic-interaction proof, move it into the module, or drop it. Recommend: move to the module (or drop)
   — the engine keeps only the pipeline, not a concrete action.
8. **Firepotion/invincibility + the transient `firefox` armor.** BQ's firepotion grants 15 s invincibility + a
   sprite swap, cancellable early by looting armor. Model invincibility **server-side** (a `qualify`/`execute` zero-
   damage check, §4.d) with a `caps.timer` revert; confirm `firefox` is a non-ranked equipment kind the formula
   ignores.
9. **Death: gear kept vs lost.** Classic BQ keeps gear on death (checkpoint respawn, not a roguelike). Confirm no
   gear loss (the plan assumes BQ-faithful: keep gear, respawn at nearest checkpoint, full HP — §4.h).
10. **Depth of the reserved Match/ledger/custody stubs at P0.** How much shape to lay now (interface members +
    CTK "can express a Match") vs. truly deferring. The plan recommends: full interface members (cheap, keeps the
    CTK honest), zero machinery (no MatchRoom/barrier/ledger built for BQ) — confirm this is the right cut.
11. **Multi-shard/Channels.** Classic BQ ran 5×200 parallel shards of the identical map (players in different
    shards never interact). Celestia models this as the Channels seam (WORLDS.md §7). Confirm a single channel for
    launch concurrency, Channels when a zone overflows one process.

---

## 12. TL;DR (summary)

- **P0 extraction deliverable:** extract the Celestia engine from the Atlas monolith behind the full Worked-B
  `GameModule`/`ModuleRegistry`/`RoomCaps` contract, and ship the **current POC unchanged** *as* `@celestia/game-bq`
  (codename **Perseus**). Move only the BQ nouns out (attack action, mob tactic labels/seed, player stats, component
  field sets, item/zone content); keep the generic engine (ECS, Fornax pipeline, Pallas, event-sourcing, Caelum,
  identity/session) in place. **DoD:** the POC plays identically as a module (login→zone→move→attack→mob-AI→respawn,
  all tests green); `dependency-cruiser` arch-test red on any engine→game edge (G3); `engine.mount('bq')` is the
  only place a concrete module is named; the **CTK runs green in CI** (allow()-before-execute, resolveResource from
  state, game_id enforced, pure event reducers, bounded enumerate, module can express a Match though BQ stubs it).
- **Top missing gameplay systems for a playable BQ (all additive):** (1) inventory + **slot-generic equipment**
  (a generic slot→item map + additive stat modifiers + a module formula — BQ's weapon/armor are just two slots,
  changing stats via BQ's `dmg`/`maxHP=80+(aLvl−1)×30` AND the sprite layers; the same mechanism is cozy's tools);
  (2) **loot drops + chests** (per-
  mob drop tables, static + chest-area chests); (3) **consumables as item use-effects + a minimal status/buff
  system** (flask/burger `heal`, firepotion `invulnerable`, out-of-combat `regen` — statuses fold into the same
  stat aggregation as equipment and tick on `caps.timer`; the generic skill/buff shape serves cozy/RPG later);
  (4) **NPCs + scripted dialogue** + chat; (5) **achievements** (20, server-detected); (6) the **client UI layer**
  (health bar, inventory, dialogue bubbles, toasts — a DOM overlay, since the single-string HUD seam is
  insufficient); (7) **world breadth** (more Caelum areas via the existing portal seam).
- **How it de-risks cozy:** BQ proves the *structural* engine cozy needs with **zero rework** — the module contract,
  the action pipeline, per-room-type tick driver, seeded-RNG event-sourcing (the offline-fast-forward linchpin),
  `caps.timer`, the Pallas spine, the content-driven Caelum pattern, and `game_id` isolation. Cozy then adds only
  its content + the value-movement engine (EconomyService/custody/escrow) that BQ deliberately does not exercise.
- **Biggest open question:** the **persistence/economy depth** — BQ needs almost no persistence and **no
  EconomyService (G5)**, so BQ gives the hardest correctness surface (ledger + custody + escrow) *zero* exercise.
  The discipline that keeps re-sequencing safe is to lay those seams' **shape** now while pre-production is cheap
  (never contradict G5/single-writer), and build + property-test the machinery during cozy — not to mistake "BQ
  shipped" for "the engine is finished" (PLATFORM.md Risk 1).
