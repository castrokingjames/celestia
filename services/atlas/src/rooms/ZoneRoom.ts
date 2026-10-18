// The authoritative zone room — 20 Hz FIXED tick (docs/REALTIME.md §2-3). The server owns truth; the client
// sends typed input commands and predicts/reconciles locally. The room owns a World (entity + component store,
// incl. this zone's collision map from Caelum) and a fixed list of Systems; each 20 Hz step advances the server
// clock, runs every System in order (docs/PLATFORM.md §2), then checks portal crossings. Movement lives in
// MovementSystem; inputs are QUEUED on the World and drained there. The zone is PARAMETERIZED: a per-instance
// zoneId (set when the seat is created) picks the zone from the Caelum registry — map, spawns, portals
// (docs/REFACTOR.md S2). Position is write-behind: resolved on join (saved placement / named spawn / default),
// flushed on leave + a periodic autosave (CHARACTERS §6).
import { Room, Client } from "@colyseus/core";
import { ZoneState, Player, LeverState } from "../schema/ZoneState.js";
import {
  MSG,
  type InputCommand,
  type InteractCommand,
  type SeatReservation,
  type ZoneMapMsg,
  type ZoneSeatAuth,
  type ZoneTransferMsg,
} from "@celestia/norma";
import { portalAt } from "@celestia/firmament";
import type { Portal, Repository, WorldRegistry, ZoneDef } from "@celestia/firmament";
import { World, type PlacementRef } from "../ecs/world.js";
import { MovementSystem } from "../ecs/systems/movement.system.js";
import type { System, TickContext } from "../ecs/types.js";
import { reserveZoneSeat } from "./seat-reservation.js";
import {
  ActionPipeline,
  SignalBus,
  leverAction,
  LEVER_TOGGLED,
  INTERACT,
  type Actor,
  type EventSink,
  type ZoneInteractions,
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
  autosaveIntervalSec: number;
  /** Which zone this instance simulates — set per-instance when the seat is created (also published as room
   *  metadata so a seat reservation can find the right instance). Falls back to the manifest starting zone. */
  zoneId?: string;
};

const TICK_HZ = 20;
const TICK_MS = 1000 / TICK_HZ;
// How close (world units) a player must be to a lever to interact — the Fornax `qualify` reach gate (~1.5 tiles).
const INTERACT_REACH = 48;

export class ZoneRoom extends Room<ZoneState> {
  private world!: World;
  // Systems run in order each tick; movement first (more join later: interactions, combat, mob AI).
  private systems: System[] = [];
  private deps!: ZoneRoomDeps;
  private zone!: ZoneDef;
  private pipeline!: ActionPipeline<ZoneInteractions>;
  private autosaveTimer?: ReturnType<typeof setInterval>;
  // Sessions mid-transfer to another zone — skip their portal re-check until they leave.
  private readonly transferring = new Set<string>();

  async onCreate(options: ZoneRoomDeps) {
    this.deps = options;
    this.zone = options.registry.requireZone(options.zoneId ?? options.registry.startingZoneId());
    this.setState(new ZoneState());
    this.world = new World(this.state, this.zone.map);
    this.systems = [new MovementSystem()];

    // Fornax — the in-game action pipeline (enumerate→allow→qualify→execute→event→signal). The durable sink
    // comes from the composition root via a port-typed factory (DurableEventSink → log.event); a server-side
    // listener proves signals fire.
    const sink = this.deps.makeEventSink(this.zone.id);
    const signals = new SignalBus();
    signals.on(LEVER_TOGGLED, (s) => log.debug("signal", { zone: this.zone.id, type: s.type, data: s.data }));
    this.pipeline = new ActionPipeline([leverAction], sink, signals);

    // Seed one lever at the map centre (walkable in the dummy maps) — a POC interactable; real levers come from
    // zone content later (G3).
    const seed = new LeverState();
    seed.id = `${this.zone.id}-lever`;
    seed.x = (Math.floor(this.zone.map.width / 2) + 0.5) * this.zone.map.tileSize;
    seed.y = (Math.floor(this.zone.map.height / 2) + 0.5) * this.zone.map.tileSize;
    this.state.levers.set(seed.id, seed);

    this.setSimulationInterval(() => this.step(), TICK_MS);
    this.setPatchRate(TICK_MS);

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
      zoneId: this.zone.id,
      map: { width: map.width, height: map.height, tileSize: map.tileSize, tiles: map.tiles, portals: map.portals },
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

  // Fixed 20 Hz step: advance the server clock, run every System, then check for portal crossings.
  private step() {
    this.state.t += TICK_MS;
    const ctx: TickContext = { dtMs: TICK_MS, tMs: this.state.t };
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
