<!-- The real-time MMO architecture: combat/tick profile, netcode (prediction/interpolation/responsiveness), spatial topology (World>Zone>Sector + Channel/Instance), AoI, state layers, and scaling. SUPERSEDES the cozy/low-tick/tap-to-move premise in TECH-STACK/BUILD-PLAN/INFRA — see §11. Derived from the design session; written to be reviewed later. -->

# REALTIME.md — Real-Time World, Netcode & Scaling

> **Scope.** How the real-time multiplayer world actually works: the combat/tick profile, the netcode that makes it feel responsive, the spatial topology (zones/sectors/channels), interest management, the state layers, and how it scales. **This doc supersedes the "cozy / low-tick / tap-to-move" premise** that earlier docs were written on (see **§11 Supersedes**). Companion to `ARCHITECTURE.md` (end-to-end seams) and `TECH-STACK.md` (Colyseus/Godot choices).

---

## 1. Premise (the correction)

Celestia is a **real-time MMO** with **real-time directional movement** and **basic hack-and-slash combat** (Shining Soul / Zenonia / Inotia / RO-field style). It is **not** cozy, **not** tap-to-move, and **not** competitive/twitch. The combat is **forgiving PvE** — generous hitboxes, no frame-perfect precision. The responsiveness bar is simply: **"doesn't look like it's lagging or delayed."** Not esports-grade; just snappy.

Everything below follows from that profile.

---

## 2. Tick & clocks

**Server authoritative simulation: 20 Hz (locked).** Not 40, not 60. Per-zone configurable (see §5), but 20 is the world default.

There are **three decoupled clocks** — they do **not** have to match:

| Clock | Rate | Role |
|---|---|---|
| **Client render** | 60 fps (device-dependent) | draws frames — purely local/visual |
| **Server sim tick** (`setSimulationInterval`) | **20 Hz** | advances authoritative game logic — **fixed timestep** (deterministic → replay-safe) |
| **Server send/patch** (`setPatchRate`) | ~20 Hz | binary state deltas to clients |

Client render FPS does **not** dictate server tick. The server simulates 20×/sec; the client turns that into smooth 60 fps via interpolation + prediction (§3).

**Why 20 Hz is right here** (basic hack-and-slash, forgiving PvE):

| Genre | Server tick | Why |
|---|---|---|
| Competitive FPS (CS/Valorant) | 64–128 | frame-tight aim + fairness |
| MOBA (Dota/LoL/ML) | ~30 | targeted/skillshot abilities, prediction-heavy |
| **Celestia (hack-and-slash PvE)** | **20** | forgiving hitboxes, no competitive aim, generous/server-resolved hits |

Even MOBAs are only ~30 Hz; the high-tick cases are shooters, and that's for hit-reg *precision*, not responsiveness. We're less demanding than a MOBA.

---

## 3. Responsiveness ≠ tick rate (the key principle)

> **"Feels responsive / not laggy" is a client-side prediction + interpolation + ping problem — NOT a tick-rate problem.** 20 Hz done right feels instant; 60 Hz done wrong feels laggy. Prediction >> tick.

The math: 20→40 Hz saves only **~12.5 ms** of average server-processing latency — below perception, and moot anyway because prediction removes the entire round-trip for your own actions. It's dwarfed by RTT (30–100 ms) and the interpolation buffer (~100 ms).

**The snappy-at-20 recipe (the whole combat netcode):**

- **Client-side prediction** on your own **movement + attack** → you move/swing the instant you press, zero wait.
- **Immediate local feedback** on input → swing animation + hit spark + sound + screenshake fire *now*, client-side. (This is what sells "instant.")
- **Server-authoritative damage/death** → never trust the client for hits/kills; the server resolves at its 20 Hz tick against authoritative positions, with **generous hitboxes** to absorb the interp gap. Client silently reconciles if the server disagrees (rare, invisible for forgiving melee).
- **Entity interpolation** for other players/enemies → render ~100 ms behind, lerp between snapshots → smooth motion, no stutter/teleport.
- **Low ping** → put the server in a region near the players.
- **No lag compensation** (PvE forgiving). Only revisit if a *precise PvP* mode is ever added.

**The one trap:** the only thing that makes it feel laggy is **not predicting** (tap → wait for server round-trip → then act). No tick rate fixes that; prediction removes it. So "not laggy" ≡ "we do client-side prediction," full stop.

```
SERVER   tick 20Hz → sim → patch ~20Hz → (sparse snapshots)
CLIENT   predict self (0ms feel) + immediate feedback + interpolate others → render 60fps smooth
```

---

## 4. Tick is fidelity, not a scaling lever

Raising the tick does **not** "scale up" — it scales you **down**:

```
server CPU ≈ players × tick_rate × work_per_player
capacity_per_box ∝ 1 / tick_rate
```

So **20→40 Hz ≈ 2× per-player cost → ~half the CCU per box.** Tick is a **fidelity** choice (set once per zone); you raise it only if gameplay needs precision, and you **pay for it in capacity** (scale that zone ~proportionally — see §10). You never raise the tick to get more players.

**Per-zone tick:** each zone/channel is its own room, so each can set its own `setSimulationInterval`. World default 20 Hz; a hypothetical competitive-PvP arena could run ~30 Hz and be provisioned ~proportionally — **scoped to that zone, never global, never 60.** (No competitive mode is planned; this is just the escape hatch.)

---

## 5. Spatial topology — World > Zone > Sector (+ Channel, Instance)

```
World                 the whole game (Polaris + Postgres — durable identity/economy; NOT a room)
 └─ Zone              a logical map — "Prontera", "Prontera-field"  — the ISOLATION BOUNDARY
     └─ Channel       a capped parallel COPY of the zone for capacity — "Prontera-Ch3"
         └─ Sector    AoI granularity inside a channel (any shape — grid/quadtree/hex; just a spatial index)

Instance             a special/private ephemeral room — special dungeon, private room
```

| Level | What it is | Backed by | Boundary meaning |
|---|---|---|---|
| **World** | entire game; sum of all zones | Polaris + Postgres (not a room) | durable self spans it |
| **Zone** | a discrete self-contained map | a room (or channels / an instance) | **isolation** — zones share no real-time state; crossing = handoff |
| **Channel** | a capped running copy of a zone (`Prontera-Ch3`) | one Colyseus room (one thread) | **capacity + distribution** — group-aware; 1..N per zone |
| **Sector** | AoI subdivision inside a channel | spatial index (or chunk-room in the hub) | **AoI** — you only exchange updates with nearby Sectors |
| **Instance** | special/private ephemeral room | an ephemeral room | per-group content/privacy |

Two **orthogonal** axes (don't confuse with the subdivision): **Channel** = persistent capacity-copy of a zone; **Instance** = ephemeral private copy. Both are "copies of a zone," not spatial subdivisions.

**Boundaries are zoned, not seamless** (RO-style map transitions). Crossing a zone = a clean handoff (§9), not seamless cross-room visibility. This is the proven, simpler model; seamless cross-zone is deliberately *not* built.

---

## 6. Zone-type patterns

| Zone type | Model | Why |
|---|---|---|
| **Active** (field, dungeon, combat) | **1 zone = 1 room + Sector/StateView AoI inside**; handoff only at the zone edge | the adjacent-Sector seam would break movement/combat/visibility, so Sectors are an *internal AoI index*, **not** rooms |
| **Idle hub** (Prontera, vending) | may **micro-zone Sectors into chunk-rooms** to spread across cores | idle → no handoff thrash; social interactions are **non-spatial** (trade/party/whisper by player-ID) so a room boundary doesn't block them; seam is cosmetic; **beats channels for a vending economy** (keeps the market tiled into one city instead of fragmenting it across copies) |

- **Active-zone AoI** is a **radius query** centered on the player, served from the Sector index — not "my grid square." Handoff happens at the **zone** seam (coarse, with hysteresis), never per-Sector.
- **Dungeons: shared vs instanced is a gameplay choice** — shared (RO-style, tier-2 zone room) or instanced-per-party (Instance, ephemeral). Can mix. *(Open — see §12.)*

---

## 7. Interest management (AoI)

- **StateView (Colyseus 0.16 / schema 3.x)** is the native per-client filter: tag entities `@view()`, give each client a `StateView`, update it from the Sector index as players move → **far players don't receive your deltas even in the same zone.** This is **P0-core** (not P1 as earlier docs had it).
- **Private state** (inventory, etc.) is **not broadcast** — scope it to the owner via StateView, or push via targeted `client.send()`. Continuous/shared state (positions) → schema; private/discrete state → view or targeted messages.
- **Change-based sync, never periodic** — Colyseus schema diffs state and sends **binary deltas** only when something changes. Model collections (`MapSchema`/`ArraySchema`) so deltas are per-item. Opening the inventory UI = a **client-side render of the already-synced local copy** → zero server traffic. Only the initial sync on join is a full snapshot.
- **AoI cuts bandwidth, not server CPU.** The thread still simulates all entities + encodes a per-client view each patch. So the per-channel cap is set by **per-client view-encoding + spatial queries at 20 Hz × N**, not by bandwidth — **load-test it** (see §12).

---

## 8. State layers

| Layer | Role | Lifetime |
|---|---|---|
| **Room memory** (Colyseus) | the **live authoritative working copy** — serves all online reads | ephemeral (while the room lives) |
| **Postgres** | the **durable source of truth** + global systems (accounts, inventory, COIN, event log) | permanent |
| **Redis/Valkey** | **cross-process hot layer** — handoff, Polaris reads, write-behind, presence, rate-limit, tokens, cache | ephemeral — **never truth** |

- **Online player state lives in room memory.** Opening your inventory = an **in-memory read, instant, zero DB/Redis hit** (the client even has a synced view). The room *is* the hot store for the online player.
- **Data flow:** `join → load from Postgres into room memory → read/mutate in room memory (free) → write-through to Postgres on change (via the event log) → Redis for cross-process visibility`.
- **Redis's role for player state** is the **cross-process** cases room memory can't cover: zone handoff (stash snapshot for the next room), Polaris/API reads outside a room, write-behind buffering, anything shared across zones. **Redis is ephemeral/cache/coordination, never the source of truth.** Postgres owns durable data.
- **Redis is in from the start** (cheap, inevitable) — it *must* be on the moment you go multi-process (§10), because `LocalPresence` doesn't cross processes.

---

## 9. Zone transition (handoff)

Zones are isolated (no shared real-time state), but the **player is continuous** because durable identity lives in the Polaris tier/DB. Crossing a zone:

```
persist current state → leave room A → (Polaris/matchmaker routes) → join room B → rehydrate from DB/Redis
```

The room is just the **live stage** for an area; the DB is **who you are**. Cross-zone things that feel like they "span" (party with a friend in another zone, global chat, your global COIN, a trade) are **non-spatial** — handled by the Polaris tier/economy by player-ID, never through a zone room.

---

## 10. Scaling

**Capacity scaling is orthogonal to tick (§4) and is a deploy/infra concern, not a rewrite — room code is unchanged throughout.**

| Lever | What | Capacity effect | Redis? |
|---|---|---|---|
| ~~Raise tick rate~~ | 20→40 Hz | ❌ **reduces** capacity (~halves it) — not scaling | — |
| **Vertical** | bigger box (RAM/faster core) | ✅ modest — **single-thread-limited** (extra *cores* don't help one process) | no |
| **PM2 multi-process** | 1 process per core (+ matchmaker routing) | ✅✅ the real per-box unlock — uses all cores | **yes** (Local→Redis flip) |
| **Channels** | split a zone into capped room-instances, group-aware | ✅✅ distribute across cores/boxes | yes |
| **Multi-box** | more machines + matchmaker + shared Redis + LB (handshake only) | ✅✅✅ effectively unbounded | yes, shared |
| **AoI/density tuning** | less work per player per tick | ✅ more players at the same 20 Hz | — |

- **PM2 = process manager (cores), not the sticky router.** PM2 spreads *processes* across cores; **Colyseus's matchmaker + Redis driver** route *players* to the specific process hosting their room (seat reservation + sticky WS). A generic LB only fronts the initial handshake — it can't round-robin live stateful WS traffic. PM2 is per-host (doesn't span machines).
- **Multi-process ⇒ Redis required** — the first `pm2 scale >1` flips `LocalPresence`→`RedisPresence`+`RedisDriver`. "Valkey turns on" and "go multi-process" are the same moment.
- **~1000 CCU/channel is a target to load-test, not a given** — the real ceiling is per-client StateView encoding + spatial queries at 20 Hz × N.
- **Load distributes across many zones (power-law, not uniform)** — the hub (Prontera) holds a disproportionate share; fields/dungeons are thin. **Size for the hotspot (the hub), not the average.** A packed-but-idle hub (vending, static entities → cheap deltas) can be lighter per tick than a smaller *active* combat field — so the two zones to stress-test are **the hub (population)** and **a busy combat field (per-tick activity)**.
- **Now:** 1 channel, 1 process, LocalPresence, vertical only. Scale on measured signals (tick-duration p95, CPU, RAM).

---

## 11. Supersedes (stale premises now overridden)

This doc overrides the following, written on the old cozy/low-tick/tap-to-move premise:

- **TECH-STACK.md:**
  - tick "2–10 Hz low-tick" → **20 Hz real-time**;
  - "tap-to-move primary" InputMap → **real-time directional** movement (virtual stick / WASD);
  - **StateView / AoI "P1"** → **P0-core**;
  - "couple hundred per room, single thread, fine" → the **Zone/Channel/Sector** model with a **load-tested per-channel cap**;
  - dialogue HTML `<input>` overlay "core P0" → **dev/tester-console only** (players: one-way NPC display, no free-text).
- **BUILD-PLAN.md:**
  - the **"offline, no-login, no-users sandbox"** framing → **dropped** (it's an MMO with players and player storage from the start; the de-risking spikes still stand, but not the "no users/no storage" framing);
  - low-tick premise → 20 Hz;
  - **`CelestiaSDK`** autoload/composition-root → **`Jupiter`** (locked codename).
- **INFRA.md:**
  - "cozy, low-tick, $5 box, RAM-bound, cozy CCU-per-core" → **real-time sizing**: 20 Hz, per-channel cap from load test, **PM2 multi-core** as the per-box scaling unit, **Redis-on-at-multi-process**, size-for-the-hub-hotspot. (The lean/phased philosophy stays; the *numbers and the "cheap forever" tone* change for real-time load.)

---

## 12. Open items (→ `OPEN-QUESTIONS.md`)

- **Per-channel CCU cap** — load-test per-client StateView encoding + spatial queries at 20 Hz × N; stress the **hub (population)** and a **busy combat field (activity)** separately. "1000" is a target to verify.
- **Dungeons: shared (tier-2 zone) vs instanced (Instance/ephemeral)** — gameplay choice, undecided; can mix.
- **Sector shape + size** — any shape; must be ≥ interaction/view range for the hub's chunk-room scheme to avoid a visible seam.
- **Hub chunk-room seam** — accept the cosmetic seam, or 3×3 neighbor-subscription to hide it (only if it bothers in practice).
