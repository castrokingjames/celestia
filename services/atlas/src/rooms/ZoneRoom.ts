// The authoritative zone room — fixed-timestep tick at the zone's configured tickHz (Caelum zone.json;
// docs/REALTIME.md §2-3). The server owns truth; the client sends typed input commands and predicts/reconciles
// locally. The room owns a World (entity + component store, incl. this zone's collision map from Caelum) and a
// fixed list of Systems; each step advances the server
// clock, runs every System in order (docs/PLATFORM.md §2), then checks portal crossings. Movement lives in
// MovementSystem; inputs are QUEUED on the World and drained there. The zone is PARAMETERIZED: a per-instance
// zoneId (set when the seat is created) picks the zone from the Caelum registry — map, spawns, portals
// (docs/REFACTOR.md S2). Position is write-behind: resolved on join (saved placement / named spawn / default),
// flushed on leave + a periodic autosave (CHARACTERS §6).
import { Room, Client } from "@colyseus/core";
import { ZoneState, Player, MobState } from "../schema/ZoneState.js";
import {
  MSG,
  NET_MSG,
  isBodyWalkable,
  type AttackCommand,
  type InputCommand,
  type InteractCommand,
  type PingMsg,
  type SeatReservation,
  type ZoneMapMsg,
  type ZoneSeatAuth,
  type ZoneTransferMsg,
} from "@celestia/norma";
import { portalAt } from "@celestia/firmament";
import type { MobKind, Portal, Repository, WorldRegistry, ZoneDef } from "@celestia/firmament";
import { World, type PlacementRef, type MobAgent } from "../ecs/world.js";
import { MovementSystem } from "../ecs/systems/movement.system.js";
import { MobAISystem } from "../ecs/systems/mob-ai.system.js";
import { PLAYER_MAX_HP, PLAYER_DAMAGE, PLAYER_ATTACK_REACH } from "../content/player.js";
import { MOB_TACTIC_SEED } from "../content/mob-situations.js";
import { Pallas, HashEmbedder, InMemoryMnemosyne, type PrecedentStore } from "../pallas/index.js";
import type { System, TickContext } from "../ecs/types.js";
import { reserveZoneSeat } from "./seat-reservation.js";
import {
  ActionPipeline,
  SignalBus,
  leverAction,
  LEVER_TOGGLED,
  INTERACT,
  attackAction,
  ATTACK,
  ENTITY_DAMAGED,
  ENTITY_KILLED,
  type Actor,
  type EventSink,
  type ZoneInteractions,
  type ZoneCombat,
} from "../fornax/index.js";
import type { SessionRegistry } from "../themis/session-registry.js";
import { gateAccountStatus } from "../themis/revocation.js";
import { createLogger } from "@celestia/argus";

const log = createLogger("atlas:zone");

/** Deps handed to the room by the composition root (main.ts) via Colyseus define options — Colyseus
 *  instantiates rooms itself, so this is the DI injection point. */
export type ZoneRoomDeps = {
  registry: WorldRegistry;
  repo: Pick<Repository, "loadSpawn" | "savePlacement" | "getAccountById">;
  sessions: SessionRegistry; // one-session registry + kick surface (Themis); zone sockets register so the sweep reaches a sitting player
  makeEventSink: (stream: string) => EventSink; // port-typed factory; only main.ts names the concrete sink (G7)
  precedents: PrecedentStore; // the mob brain's seeded precedent store (pgvector in prod); port-typed, named only in main.ts (G7)
  autosaveIntervalSec: number;
  /** Which zone this instance simulates — set per-instance when the seat is created (also published as room
   *  metadata so a seat reservation can find the right instance). Falls back to the manifest starting zone. */
  zoneId?: string;
};

// How close (world units) a player must be to a lever to interact — the Fornax `qualify` reach gate (~1.5 tiles).
const INTERACT_REACH = 48;
// Respawn defaults (scatter radius + corpse-overlap window) are GLOBAL sim config — config/world.json `respawn`,
// loaded via Caelum (this.deps.registry.respawn). A zone's spawn row may override scatter per-spawn.

export class ZoneRoom extends Room<ZoneState> {
  private world!: World;
  // Systems run in order each tick; movement first (more join later: interactions, combat, mob AI).
  private systems: System[] = [];
  private mobSeq = 0; // monotonic counter → unique respawn ids (`<zone>-<kind>-r<seq>`)
  private deps!: ZoneRoomDeps;
  private zone!: ZoneDef;
  private tickMs!: number; // fixed timestep (ms) — derived from the zone's configured tickHz (Caelum)
  private pipeline!: ActionPipeline<ZoneInteractions>;
  private combat!: ActionPipeline<ZoneCombat>;
  private pallas!: Pallas; // the mob brain — seeded precedent retrieval (tier-1; no model wired)
  private autosaveTimer?: ReturnType<typeof setInterval>;
  // Sessions mid-transfer to another zone — skip their portal re-check until they leave.
  private readonly transferring = new Set<string>();

  async onCreate(options: ZoneRoomDeps) {
    this.deps = options;
    this.zone = options.registry.requireZone(options.zoneId ?? options.registry.startingZoneId());
    // Integer fixed-timestep from zone config: round to whole ms so the sim clock (state.t) — the event-log `at`
    // timestamp (bigint) AND the interpolation timeline — stays integer and drift-free. A non-divisor tickHz
    // (e.g. 60 → 17ms ≈ 58.8 Hz) runs at the nearest whole-ms rate; the HUD shows the real value.
    this.tickMs = Math.max(1, Math.round(1000 / this.zone.tickHz));
    this.setState(new ZoneState());
    this.world = new World(this.state, this.zone.map);

    // Pallas — the mob brain. Tier-1 seeded-precedent retrieval only (no model gateway wired); seed once per room.
    // Mobs decide via this; the choice comes from the seed data, never a branch in the AI system (DECISIONS §2).
    this.pallas = new Pallas(new HashEmbedder(), new InMemoryMnemosyne(), this.deps.precedents, null, "gates");
    // Seed the shared precedent store (replace-per-schema). Degrade gracefully: if the store is unreachable (e.g.
    // the 0005 pgvector migration/extension isn't applied), log it and carry on — mobs fall to the wander floor
    // on a retrieval miss rather than failing room creation.
    try {
      await this.pallas.seed("mob.tactic", MOB_TACTIC_SEED);
    } catch (err) {
      log.warn("precedent seed failed — run the 0005 migration? mobs will wander", { zone: this.zone.id }, err);
    }

    // Systems run in order each tick: players move first, then mobs perceive/decide/act.
    this.systems = [
      new MovementSystem(),
      new MobAISystem(
        this.pallas,
        (kind) => this.deps.registry.mobKind(kind), // stats from the Caelum-loaded roster (content/mobs.json)
        (mobId, targetId) => this.dispatchMobAttack(mobId, targetId),
        (kind, homeX, homeY, scatter) => this.spawnMobAt(kind, homeX, homeY, scatter), // respawn = a brand-new unique entity
      ),
    ];

    // Fornax — the in-game action pipeline (enumerate→allow→qualify→execute→event→signal). The durable sink
    // comes from the composition root via a port-typed factory (DurableEventSink → log.event); a server-side
    // listener proves signals fire.
    const sink = this.deps.makeEventSink(this.zone.id);
    const signals = new SignalBus();
    signals.on(LEVER_TOGGLED, (s) => log.debug("signal", { zone: this.zone.id, type: s.type, data: s.data }));
    this.pipeline = new ActionPipeline([leverAction], sink, signals);

    // Combat shares the zone's one event stream (sink) + signal bus. entity_killed drives death/respawn here;
    // the mob brain (Pallas, next increment) re-validates its own attacks through this same pipeline (G2).
    signals.on(ENTITY_DAMAGED, (s) => log.debug("signal", { zone: this.zone.id, type: s.type, data: s.data }));
    signals.on(ENTITY_KILLED, (s) => this.onEntityKilled(String(s.data.targetId)));
    this.combat = new ActionPipeline([attackAction], sink, signals);

    // (No seeded lever — removed from the POC scene. The interact pipeline + LeverState remain for when real
    // interactables come from zone content, G3.)

    // Seed a few mobs near the default spawn — POC content (real spawn tables come from zone content later, G3).
    this.seedMobs();

    this.setSimulationInterval(() => this.step(), this.tickMs);
    this.setPatchRate(this.tickMs);

    // QUEUE inputs on the World — MovementSystem drains them on the fixed tick (decoupled from arrival jitter).
    this.onMessage("input", (client: Client, cmd: InputCommand) => {
      if (!cmd) return;
      this.world.inputs.get(client.sessionId)?.push(cmd);
    });

    // Interactions run through Fornax (not applied here): the pipeline gates, executes, logs the event + signals.
    this.onMessage(INTERACT, (client: Client, cmd: InteractCommand) => {
      // Guard: a durable-append failure in the pipeline must LOG, not become an unhandled rejection (crash).
      this.onInteract(client, cmd).catch((err) => log.error("interact failed", { zone: this.zone.id }, err));
    });

    // Attacks also run through Fornax — the server resolves the target, checks reach/liveness, and COMPUTES the
    // damage (client sends only a target id; G1).
    this.onMessage(ATTACK, (client: Client, cmd: AttackCommand) => {
      this.onAttack(client, cmd).catch((err) => log.error("attack failed", { zone: this.zone.id }, err));
    });

    // Latency probe: echo the client's timestamp straight back so the SDK can measure RTT. Stateless + opaque —
    // the server never interprets `t`, so this adds no wall-clock to the sim (G9).
    this.onMessage(NET_MSG.ping, (client: Client, m: PingMsg) => client.send(NET_MSG.pong, m));

    // Write-behind: periodically flush live positions to character_placement (also flushed on leave).
    this.autosaveTimer = setInterval(() => this.flushAll(), this.deps.autosaveIntervalSec * 1000);

    // Publish the zone id as room metadata so a seat reservation can find + reuse the right instance.
    await this.setMetadata({ zoneId: this.zone.id });
  }

  // A zone is reachable ONLY through a seat reservation (lobby enter / portal transfer): the reserver attaches
  // the verified identity as authData, so Colyseus sets client.auth from that server-held data and SKIPS onAuth.
  // onAuth runs only for a DIRECT join (no reservation) — which we reject. Identity never comes from the client
  // (client-never-trusted / G1 / G11).
  async onAuth(): Promise<never> {
    throw new Error("enter the world through the lobby");
  }

  async onJoin(client: Client) {
    const auth = client.auth as ZoneSeatAuth;
    // Synchronous status gate at the zone door — zero entry window for a ban that landed since the lobby check,
    // reading authoritative state via Atlas's SELECT-on-account grant; fail-closed. Then register the socket so
    // the Themis sweep can evict a player who gets banned while sitting in a zone. (A legit portal transfer
    // briefly registers the new zone socket, displacing the old with 4409 — benign: that socket was leaving.)
    const account = await this.deps.repo.getAccountById(auth.accountId);
    if (!gateAccountStatus(account?.status).ok) {
      client.leave(4403);
      return;
    }
    this.deps.sessions.register(auth.accountId, client);

    const player = new Player();
    const saved = await this.deps.repo.loadSpawn(auth.characterId);
    player.name = saved?.name ?? "";
    player.maxHp = PLAYER_MAX_HP; // server owns health; spawn at full (per-character stats come later)
    player.hp = PLAYER_MAX_HP;

    const map = this.zone.map;
    if (auth.spawn) {
      // Arriving at a named spawn (portal transfer) — validated to exist at boot; fall back to default.
      const s = map.spawns[auth.spawn] ?? map.spawns.default;
      player.x = s.x;
      player.y = s.y;
    } else if (saved && saved.zoneId === this.zone.id && saved.x != null && saved.y != null) {
      // Resume: continuing in the zone we were last saved in.
      player.x = saved.x;
      player.y = saved.y;
    } else {
      // Fresh character (or no saved position in this zone): the zone's default spawn.
      player.x = map.spawns.default.x;
      player.y = map.spawns.default.y;
    }

    const placement: PlacementRef = { characterId: auth.characterId, zoneId: this.zone.id };
    this.world.spawnPlayer(client.sessionId, player, placement);

    // Hand the map to the client to render (floor + boxes + portals) — a one-shot message, not synced state.
    const mapMsg: ZoneMapMsg = {
      worldId: this.deps.registry.worldIdOf(this.zone.id),
      zoneId: this.zone.id,
      map: {
        width: map.width,
        height: map.height,
        tileSize: map.tileSize,
        tiles: map.tiles,
        portals: map.portals,
        ground: map.ground,
        overlay: map.overlay,
      },
      assets: this.deps.registry.assetsFor(this.zone.id), // server drives WHICH art; the client renders it (G3 opaque)
    };
    client.send(MSG.zoneMap, mapMsg);

    log.info("join", {
      zone: this.zone.id,
      session: client.sessionId,
      account: auth.accountId,
      character: auth.characterId,
      name: player.name,
      present: this.state.players.size,
    });
  }

  async onLeave(client: Client) {
    const auth = client.auth as ZoneSeatAuth | undefined;
    if (auth) this.deps.sessions.remove(auth.accountId, client);
    await this.flush(client.sessionId); // final write-behind (no-op if a transfer already despawned them)
    this.world.despawn(client.sessionId);
    this.transferring.delete(client.sessionId);
  }

  // Run an interaction through Fornax: build the per-dispatch world view (synced levers + the acting player's
  // position for the reach gate), resolve the actor from the verified seat authData (never the client — G1/G11),
  // and dispatch. The pipeline owns the gates, the write (flipping the synced lever), the event, and the signal.
  private async onInteract(client: Client, cmd: InteractCommand): Promise<void> {
    const auth = client.auth as ZoneSeatAuth;
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const actor: Actor = { accountId: auth.accountId, characterId: auth.characterId, role: auth.role };
    const world: ZoneInteractions = {
      lever: (id) => this.state.levers.get(id),
      withinReach: (leverId) => {
        const lv = this.state.levers.get(leverId);
        return lv ? Math.hypot(lv.x - player.x, lv.y - player.y) <= INTERACT_REACH : false;
      },
    };
    await this.pipeline.dispatch({ type: INTERACT, targetId: cmd?.targetId ?? "" }, actor, world, this.state.t);
  }

  // A player's attack: resolve the actor from verified seat authData (never the client), build the combat view
  // bound to the attacker's position + player damage/reach, and dispatch through Fornax (it owns the gates, the
  // damage write, the event, the signal). A dead player can't swing.
  private async onAttack(client: Client, cmd: AttackCommand): Promise<void> {
    const auth = client.auth as ZoneSeatAuth;
    const attacker = this.state.players.get(client.sessionId);
    if (!attacker || attacker.hp <= 0) return;
    const actor: Actor = { accountId: auth.accountId, characterId: auth.characterId, role: auth.role };
    const world = this.combatView(attacker.x, attacker.y, PLAYER_DAMAGE, PLAYER_ATTACK_REACH);
    await this.combat.dispatch({ type: ATTACK, targetId: cmd?.targetId ?? "" }, actor, world, this.state.t);
  }

  // The per-dispatch combat view: a target is a mob OR a player (both carry x/y/hp/maxHp), reach is measured from
  // the attacker, and `damage` is the attacker's (already computed). Used by player attacks and (next) mob attacks.
  combatView(ax: number, ay: number, damage: number, reach: number): ZoneCombat {
    return {
      target: (id) => this.state.mobs.get(id) ?? this.state.players.get(id),
      inReach: (t) => Math.hypot(t.x - ax, t.y - ay) <= reach,
      damage,
    };
  }

  // A mob's attack (chosen by Pallas, carried out by MobAISystem) runs through the SAME combat pipeline as a
  // player's — the mob is the actor, and the pipeline re-validates target/reach/liveness and owns the write (G2).
  // The mob's damage + reach come from its kind stats; a dead/vanished mob is a no-op.
  private dispatchMobAttack(mobId: string, targetId: string): void {
    const mob = this.state.mobs.get(mobId);
    const k = mob && this.deps.registry.mobKind(mob.kind);
    if (!mob || !k) return;
    const actor: Actor = { accountId: `mob:${mobId}`, characterId: mobId, role: "mob" };
    const world = this.combatView(mob.x, mob.y, k.damage, k.attackRange);
    this.combat
      .dispatch({ type: ATTACK, targetId }, actor, world, this.state.t)
      .catch((err) => log.error("mob attack failed", { zone: this.zone.id }, err));
  }

  // Death handling (fired by the entity_killed signal). A mob is marked dead + scheduled to respawn at its home
  // (the mob AI system does the actual respawn when the sim clock passes deadUntil). A player respawns now at the
  // zone's default spawn at full health (POC — no death screen yet). Server-authoritative; all times are sim-clock.
  private onEntityKilled(targetId: string): void {
    const mob = this.state.mobs.get(targetId);
    if (mob) {
      // The mob becomes a CORPSE in place (never revived). The AI system spawns a fresh unique mob near the anchor
      // at deadUntil, then flushes this corpse a beat later (corpseUntil) — so the new one shows before the body clears.
      const agent = this.world.mobAgents.get(targetId);
      const k = this.deps.registry.mobKind(mob.kind);
      if (agent && k) {
        agent.deadUntil = this.state.t + k.respawnDelayMs;
        agent.corpseUntil = agent.deadUntil + this.deps.registry.respawn.corpseOverlapMs;
        agent.targetId = null;
      }
      mob.action = "dead";
      return;
    }
    const player = this.state.players.get(targetId);
    if (player) {
      const d = this.zone.map.spawns.default;
      player.x = d.x;
      player.y = d.y;
      player.hp = player.maxHp;
    }
  }

  // Mob placement is ZONE config: each zone.json carries a `mobs` spawn table (kind + anchor + optional scatter),
  // loaded + validated by Caelum (kind resolves to content/mobs.json; anchor in-bounds). Nothing hardcoded here.
  private seedMobs(): void {
    const dflt = this.deps.registry.respawn.scatter;
    this.zone.mobs.forEach((sp, n) => this.seedMob(sp.kind, sp.at.x, sp.at.y, sp.scatter ?? dflt, n));
  }

  // Initial seed: the authored (x,y) IS the anchor, nudged to the nearest body-clear tile (so a content anchor
  // that lands on/half-in a wall doesn't trap the mob). Unknown kind → skip (never silently spawn junk).
  private seedMob(kind: string, x: number, y: number, scatter: number, n: number): void {
    const k = this.deps.registry.mobKind(kind);
    if (!k) return;
    const pos = this.resolveSpawn(x, y, k.radius);
    this.registerMob(kind, k, pos.x, pos.y, pos.x, pos.y, scatter, `${this.zone.id}-${kind}-${n}`);
  }

  // Respawn: a BRAND-NEW unique mob near an anchor (the room owns entity lifecycle — never revive a corpse).
  // The position is scattered within `scatter` of the anchor (carried from the spawn's config); the anchor stays home.
  private spawnMobAt(kind: string, homeX: number, homeY: number, scatter: number): void {
    const k = this.deps.registry.mobKind(kind);
    if (!k) return;
    const pos = this.scatterNear(homeX, homeY, k.radius, scatter);
    this.registerMob(kind, k, pos.x, pos.y, homeX, homeY, scatter, `${this.zone.id}-${kind}-r${this.mobSeq++}`);
  }

  // Create + register one mob entity: synced state (MobState) + the server-only AI agent, keyed by a unique id.
  private registerMob(kind: string, k: MobKind, x: number, y: number, homeX: number, homeY: number, scatter: number, id: string): void {
    const mob = new MobState();
    mob.id = id;
    mob.kind = kind;
    mob.x = x;
    mob.y = y;
    mob.level = k.level;
    mob.hp = k.maxHp;
    mob.maxHp = k.maxHp;
    mob.action = "idle";
    const agent: MobAgent = {
      kind,
      homeX,
      homeY,
      scatter,
      roamX: homeX,
      roamY: homeY,
      targetId: null,
      lastDecisionAt: 0,
      attackReadyAt: 0,
      deadUntil: 0,
      corpseUntil: 0,
    };
    this.world.spawnMob(id, mob, agent);
  }

  // Random body-walkable point within RESPAWN_SCATTER of the anchor. Seeded from sim time (G9: no wall-clock) so
  // it's deterministic/replayable; falls back to the nearest walkable tile centre if every sample is blocked.
  private scatterNear(homeX: number, homeY: number, r: number, scatter: number): { x: number; y: number } {
    const map = this.zone.map;
    const rand = mulberry32((Math.floor(this.state.t) ^ Math.imul(this.mobSeq, 0x9e3779b1)) >>> 0);
    for (let i = 0; i < 12; i++) {
      const ang = rand() * Math.PI * 2;
      const rr = Math.sqrt(rand()) * scatter;
      const x = homeX + Math.cos(ang) * rr;
      const y = homeY + Math.sin(ang) * rr;
      if (isBodyWalkable(map, x, y, r)) return { x, y };
    }
    return this.resolveSpawn(homeX, homeY, r);
  }

  // Nudge a desired spawn to the nearest tile CENTER whose r-half-extent body clears walls (and the map edge),
  // spiralling outward ring by ring. Falls back to the desired point if the whole map is blocked (never happens
  // in practice). Keeps content free to author rough offsets without landing a mob inside the geometry.
  private resolveSpawn(x: number, y: number, r: number): { x: number; y: number } {
    const map = this.zone.map;
    const ts = map.tileSize;
    const cx = Math.floor(x / ts);
    const cy = Math.floor(y / ts);
    const maxRing = Math.max(map.width, map.height);
    for (let ring = 0; ring < maxRing; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue; // only this ring's perimeter
          const tx = cx + dx;
          const ty = cy + dy;
          if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
          const px = (tx + 0.5) * ts;
          const py = (ty + 0.5) * ts;
          if (isBodyWalkable(map, px, py, r)) return { x: px, y: py };
        }
      }
    }
    return { x, y };
  }

  onDispose() {
    if (this.autosaveTimer) clearInterval(this.autosaveTimer);
  }

  private flushAll(): void {
    for (const id of this.world.placement.keys()) {
      this.flush(id).catch((err) => log.error("autosave flush failed", { zone: this.zone.id }, err));
    }
  }

  private async flush(id: string): Promise<void> {
    const ref = this.world.placement.get(id);
    const p = this.world.state.players.get(id);
    if (ref && p) await this.deps.repo.savePlacement(ref.characterId, ref.zoneId, p.x, p.y);
  }

  // Fixed-timestep step (zone's configured tickHz): advance the server clock, run every System, then check portals.
  private step() {
    this.state.t += this.tickMs;
    const ctx: TickContext = { dtMs: this.tickMs, tMs: this.state.t };
    for (const s of this.systems) s.update(this.world, ctx);
    this.checkPortals();
  }

  // After movement, anyone standing on a portal tile is transferred to the target zone (Atlas-internal).
  private checkPortals(): void {
    for (const client of this.clients) {
      if (this.transferring.has(client.sessionId)) continue;
      const p = this.state.players.get(client.sessionId);
      if (!p) continue;
      const portal = portalAt(this.zone.map, p.x, p.y);
      if (portal) {
        this.transferring.add(client.sessionId);
        // Guard the floated transfer: on failure, clear the flag so a later tick can retry — and never let a
        // rejected reserve/persist become an unhandled rejection that crashes the room.
        this.transfer(client, portal).catch((err) => {
          this.transferring.delete(client.sessionId);
          log.error("zone transfer failed", { zone: this.zone.id }, err);
        });
      }
    }
  }

  // Reserve a seat in the target zone (at the portal's named spawn), persist the new placement, tell the client
  // to cross, then despawn here so the source autosave/leave-flush can't clobber the new placement.
  private async transfer(client: Client, portal: Portal): Promise<void> {
    const auth = client.auth as ZoneSeatAuth;
    const target = this.deps.registry.requireZone(portal.to.zoneId);
    const spawn = target.map.spawns[portal.to.spawn] ?? target.map.spawns.default;
    await this.deps.repo.savePlacement(auth.characterId, target.id, spawn.x, spawn.y);

    const seat: ZoneSeatAuth = {
      accountId: auth.accountId,
      role: auth.role,
      characterId: auth.characterId,
      zoneId: target.id,
      spawn: portal.to.spawn,
    };
    const reservation = await reserveZoneSeat(target.id, seat);
    const msg: ZoneTransferMsg = { zoneId: target.id, seatReservation: reservation as unknown as SeatReservation };
    client.send(MSG.zoneTransfer, msg);

    // Remove them here now so they stop ticking / re-triggering; onLeave (after they consume + leave) despawns
    // again idempotently and its flush is a no-op (the placement ref is already gone).
    this.world.despawn(client.sessionId);
  }
}

// Tiny seeded PRNG (mulberry32) for respawn scatter — deterministic given the seed (no Math.random / wall-clock, G9).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
