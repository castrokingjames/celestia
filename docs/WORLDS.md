<!-- The login-flow families + the world/realm & character cardinality model. The general funnel that
     docs/CHARACTERS.md's single-world flow is one instance of. Reconciles with CHARACTERS.md (post-login),
     REALTIME.md §5 (World>Zone>Channel), PLATFORM.md §6 (scoping). Codenames per NAMING.md. -->

# WORLDS.md — Login-flow families, worlds/realms, and character cardinality

**Status:** **ANALYSIS + reserved seam.** The **single-world** funnel (`login → character → enter`) is
**as-built** (the Polaris session gateway + `docs/CHARACTERS.md`). The **World/Realm layer** (stage ②, the
`world_id` seam, `world.select`) is a **documented seam — not built** (one implicit world today, like the one
implicit `game_id`). This doc is the authority for the general shape so multi-world is additive, never a rework.
**Owners:** Platform / Engine. **Reads with:** `docs/CHARACTERS.md`, `docs/REALTIME.md §5`, `docs/PLATFORM.md §6`.

---

## 1. The common funnel

Every login flow — classic MMO, modern MMO, single-player life-sim — is the **same four stages**. Each middle
stage is **shown**, **auto-resolved**, or **merged** depending on cardinality. Nothing else is ever added.

```
┌───────────────┐   ┌────────────────┐   ┌────────────────┐   ┌─────────────────┐
│ ① AUTHENTICATE│──▶│ ② SELECT WORLD │──▶│ ③ SELECT       │──▶│ ④ ENTER         │
│    account    │   │    / realm     │   │    CHARACTER   │   │  resolve zone   │
│   (always)    │   │ (if worlds > 1)│   │  (if chars > 1)│   │  + spawn (cont.)│
└───────────────┘   └────────────────┘   └────────────────┘   └─────────────────┘
       always            world axis            char axis             always

legend:  ✔ shown to the player   ·   ⌁ auto-resolved by the server   ·   ⊕ merged into one pick
```

## 2. The families, drawn on the funnel

```
IDEAL / MEGASERVER   (single logical world · shards hidden · multi-char)   — e.g. ESO, GW2
  ①login ──▶ ②world ⌁auto ──▶ ③CHARACTER ✔ ──▶ ④enter @ last-zone (channel ⌁auto)
            └ one world, invisible sharding                     the shortest flow: player sees only ③

RAGNAROK / FlyFF / MapleStory   (multi-world · multi-char PER world)
  ①login ──▶ ②WORLD ✔ ───────▶ ③CHARACTER ✔ ────▶ ④enter @ save-point
            │ Chaos·Loki·        │ slots 1..N         │
            │ Valkyrie…          │ (tied to the realm)│  (+ a channel pick, sometimes)
            └ pick realm         └ roster per realm

STARDEW / HARVEST MOON   (a save = world + its 1 character, bundled 1:1)
  ①launch ─▶ ②③ SAVE SLOT ⊕ ──────────────────────▶ ④enter @ farm
            └ picking a save picks world + char at once
              (new slot → make farmer: name / appearance / farm)
            co-op: host loads a save; others join the HOST's world as a farmhand

ANIMAL CROSSING   (one island per account · multi-resident · visiting = other worlds)
  ①user ───▶ ②world ⌁the one island ──▶ ③RESIDENT ✔ ──▶ ④enter
                                         └ residents share the island
            visiting ──▶ ②' OTHER island (another account's world) ──▶ ④' enter as guest
```

## 3. The two axes (→ the config knobs)

Two independent cardinalities, plus two qualifiers. The whole matrix is one engine, different config:

```
                 character.max = 1                 character.max = N
               ┌────────────────────────┐       ┌────────────────────────┐
 world: single │ 1 world · 1 char        │       │ 1 world · roster        │
 (megaserver)  │   → straight to ④       │       │   → ③ only   ◀ IDEAL MMO│
               │   (single-player-online)│       │              ◀ Animal   │
               └────────────────────────┘       └────────────────────────┘
               ┌────────────────────────┐       ┌────────────────────────┐
 world: multi  │ saves (world+char 1:1)  │       │ realms · roster/realm   │
 (realms/saves)│   → ②③ merged = SLOT     │       │   → ② then ③ ◀ RAGNAROK │
               │     ◀ Stardew / HM       │       │               ◀ FlyFF   │
               └────────────────────────┘       └────────────────────────┘
```

| Knob | Values | Decides |
|---|---|---|
| `world.mode` | `single` \| `multi` | is stage ② shown? (megaserver vs realms/saves) |
| `world.kind` | `shared` \| `instanced` | a realm many share (MMO / AC island) vs a private per-save world (Stardew farm) |
| `character.scope` | `per-account` \| `per-world` | one roster, or a roster **per world** (RO ties characters to a realm) |
| `character.max` | `1` \| `N` \| `null` | is stage ③ shown? (`1` ⇒ auto) — today's `game.maxCharactersPerAccount`, generalized to per-scope |
| `character.create` | `prompt` \| `auto` | first login with 0 characters: prompt once (name/appearance), or silently auto-create a default — the "zero menus ever" switch |

Proposed config shape (today only `character.max` exists, as `game.maxCharactersPerAccount`):

```jsonc
"game": {
  "world":     { "mode": "single", "kind": "shared", "select": "auto" },
  "character": { "scope": "per-account", "max": 5, "create": "prompt" }
}
```

> **The funnel is config-derived, server-authoritative.** The gateway reads these knobs and emits/skips ②/③
> accordingly, surfacing the resulting flow to the client in `session.state` — **nothing** about cardinality or
> which screens appear is hardcoded (G8). The server still **enforces** `max`/`scope`/the cap regardless of
> what the client renders (G1); the client only *reads* the flow to decide which screens to draw.

## 4. Every reference game is one row of that config

| | `world.mode` | `world.kind` | `character.scope` | `character.max` | ⇒ player sees |
|---|---|---|---|---|---|
| **Ideal MMO** (megaserver) | single | shared | per-account | N | ③ only |
| **Ragnarok / FlyFF** | multi | shared | per-world | N | ② then ③ |
| **Stardew / Harvest Moon** | multi | instanced | per-world | 1 | ② only (slot = world + its 1 char) |
| **Animal Crossing** | single | instanced | per-world | N | ③ only (+ a separate "visit" path) |

The single-player **"save slot" needs no special concept** — it is `world.multi + instanced + char.max 1`, i.e.
a world-picker where each world owns exactly one character. Stage ②③ fuse because world and character are 1:1.

## 5. Mapping onto the engine

Our shipped session-first flow **is the IDEAL row** — ② auto (one implicit world), channel auto in ④:

```
 login ─REST─▶ session.state{ characters[], maxCharacters }        ← ③ roster
            └▶ character.create / (auto-select if max 1)           ← ③
            └▶ play.enter{ characterId } ─▶ zone ticket ─▶ Atlas    ← ④  (zone / channel ⌁auto)
```

To reach the other rows later, **ADD one layer (the ② box)** — nothing reworked, all config-gated:

```
 session.state{ WORLDS[], characters[] }                 · world.mode = multi
   └▶ world.select{ worldId }  ─────────────────────────▶ (only emitted when multi-world)
   └▶ character.* scoped to (account, worldId)           · character.scope = per-world
   └▶ play.enter ─▶ zone ticket + worldId ─▶ Atlas room (worldId, zoneId, channel)
```

The full partition hierarchy (dashed = the one node not yet in the engine):

```
 Account ─┬─ World/Realm ─┬─ Character ─┬─ Zone ─┬─ Channel
 (global) ╎  (SEAM:        │  (per world │ (a map)│ (capped copy
          ╎   world_id,    │   or acct)  │        │  of a zone)
          ╎   one today)   │             │        │
   have ──┴┈┈ seam ┈┈┈┈┈┈┈─┴── have ─────┴─ have ─┴─ seam (1 now)
```

`World/Realm` is the top partition — a separate character roster + economy boundary (RO's Chaos/Loki; a
Stardew save; an AC island). It sits above `REALTIME.md §5`'s `World > Zone > Channel`: multi-realm is simply
**more than one** of that "World" node. (Distinct from `game_id`, which separates whole *games* — cozy vs
pkmn — in `PLATFORM.md §6`; `world_id` separates *realms of one game*.)

## 6. Recommendation + what's deferred

- **Default = the megaserver (IDEAL row):** `world.single`, channels auto-resolved, character-select the only
  player-facing step. Manual world-select (RO) and manual channel-select are legacy — they fragment population
  and force character-per-world. Keep them **expressible** (config), not the default.
- **Reserve the `world_id` seam** the same way `game_id` is reserved (one `"default"` world now) so multi-world
  / save-slots / realms are additive — a `world.select` step + a column, never a schema rework. **Not built yet.**
- **Deferred with the seam:** the `world`/realm registry, `world.select`, per-world character scope, and
  `(worldId, zoneId, channel)` room keying. Single-world holds until a second world is actually wanted.

---

## 7. Spatial topology — World → Zone → Channel → Sector

What a World actually *contains* (companion to §5's routing hierarchy), and where ticks + events live. Deep
AoI/scaling mechanics are in `REALTIME.md §4–§7`; this is the at-a-glance reference.

```
WORLD    1 · server-wide · everyone is in it      events: GLOBAL (day/night, world boss, GM msg)   tick: ~1 Hz heartbeat
 └─ ZONE    a map (Prontera · prt_fild · iz_dun)  events: per-zone (weather, festival)             tick: slow / none
     └─ [CHANNEL]  optional capacity COPY of the   (a full room; spun up only when one room         tick: 20 Hz (the room)
     │             zone — its own room/process      can't hold the crowd; copies don't see
     │                                              each other)
     └─ SECTOR   a spatial cell INSIDE the room —   AoI = your sector + its neighbours (3×3)         (no tick — a filter)
                 an INDEX, not a room
```

**Two orthogonal axes — don't fuse them:**

| | question it answers | a room / connection? | effect |
|---|---|---|---|
| **Channel** (capacity) | "the zone is too crowded for one process — split it" | **yes** — a full parallel *copy* of the zone, its own 20 Hz room | more players per zone (across cores/boxes) |
| **Sector** (interest / AoI) | "which nearby entities do I get updates about?" | **no** — a spatial index inside one room | less bandwidth per client (you only sync your sector + neighbours) |

You can have **sectors with zero channels** (one room per zone, AoI inside) — the normal case until a zone
overflows one process. Sectors are deliberately **not** rooms: chopping an active combat map into
room-per-sector breaks movement/aggro across the seam (`REALTIME §6`), so it stays **one room + a spatial
index + per-client StateView**.

**Tick & events cascade down the levels:**

- **World** — a slow **~1 Hz** heartbeat (the *world clock*) + global events (day/night, weather-wide,
  world-boss timers, GM broadcasts), published down to every zone. Nothing world-wide pays the 20 Hz cost.
- **Zone** — zone-scoped state/events (Prontera sunny, `prt_fild` raining); shared by that zone's channels.
- **Channel** — the **20 Hz** authoritative room: movement, combat, the real-time sim. Tick is
  **per-room configurable** (`REALTIME §4`) — an idle hub can run slower; a turn-based battle room is
  phase-based, not a continuous tick.
- **Sector** — doesn't tick; it's the AoI filter *within* a channel.
- **Polaris** — doesn't tick at all (the account gate: request/response + the session).

**As built vs seams:**

- **Built:** one world (implicit) · one zone (`genesis`) · one channel (one `ZoneRoom`) at 20 Hz.
- **Seam — Sector/AoI:** not yet — the room broadcasts everyone to everyone (`ZoneRoom` TODO: StateView AoI);
  lands before a channel gets crowded.
- **Seam — Channels:** one room now; Colyseus spins copies at multi-process + Redis (`REALTIME §10`).
- **Seam — World heartbeat + zone events:** no world loop / zone-event state yet (the World is still just DB/meta).
