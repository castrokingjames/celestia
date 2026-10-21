// jupiter/world.ts — the game-facing WORLD. Combines the transport (europa) with the netcode (ganymede) and
// exposes PLAIN DATA + events: NO colyseus, NO renderer. Any frontend (Phaser, React, vanilla, headless)
// drives it the same way: read `self`/`players`/`levers`/`map`, call `input`/`interact`, `tick()` once per
// render frame, and subscribe to `on(...)`. It owns prediction (self), interpolation (remotes), the server
// clock, and the portal-transfer room swap — all hidden behind this surface.
import { isBodyWalkable, PLAYER_RADIUS, type AssetManifest, type SeatReservation, type ZoneMapWire } from "@celestia/norma";
import type { MobSnap, Transport, ZoneConnection, ZoneHandlers } from "./europa.js";
import { Predictor } from "./ganymede/predictor.js";
import { RemoteInterpolator } from "./ganymede/interpolator.js";
import { ServerClock } from "./ganymede/server-clock.js";

export type Vec2 = { x: number; y: number };
export type PlayerView = { x: number; y: number; name: string };
export type LeverView = { x: number; y: number; on: boolean };
export type MobView = { x: number; y: number; kind: string; level: number; hp: number; maxHp: number; action: string };

/** A unified, render-ready view of ANY entity (self / remote player / mob / lever) — the client's "component
 *  data." The netcode refreshes it each `tick()`; a RenderSystem (Pixi now, a Godot node tree later) mirrors it
 *  to views keyed by id. `kind` drives appearance; optional fields are present per kind. State lives HERE (data),
 *  never on the view objects — that's what keeps the view a swappable, stateless mirror. */
export type Entity = {
  id: string;
  kind: string; // "player" | a mob kind (e.g. "rat") | "lever"
  x: number;
  y: number;
  self?: boolean; // the local player
  name?: string; // players
  hp?: number; // players + mobs
  maxHp?: number;
  action?: string; // mobs (idle|wander|flee|attack|dead)
  on?: boolean; // levers
};
const SELF_ID = "@self"; // reserved entities key for the local player (remote ids are server session ids)
export type WorldEvent =
  | "map"
  | "playerAdd"
  | "playerRemove"
  | "leverAdd"
  | "leverChange"
  | "leverRemove"
  | "mobAdd"
  | "mobChange"
  | "mobRemove"
  | "zoneChange";

// Remote jitter buffer, sized to the ACTUAL patch cadence (not a constant) so it auto-scales with the zone's
// tickHz: ~2.5 patches behind → tight at 60 Hz (~43ms), roomy at 20 Hz (~125ms). No manual retune when tickHz
// changes. Clamped so a very high tick keeps a little cushion and a very low tick doesn't bury remotes.
const INTERP_PATCHES = 2.5;
const INTERP_MIN_MS = 40;
const INTERP_MAX_MS = 150;
const INTERP_DEFAULT_MS = 100; // until patchMs is measured (first couple of patches)
const PING_INTERVAL_MS = 1000; // how often the SDK probes round-trip latency
const nowMs = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

export class World {
  zoneId = "";
  worldId = "";
  map: ZoneMapWire | null = null;
  /** The server-driven asset manifest for this zone (base URL + entity-kind → sprite id). Null until the zone's
   *  `map` arrives, or if the world declares none (→ the renderer falls back to debug boxes). The SDK carries it
   *  opaquely; the renderer interprets it. */
  assets: AssetManifest | null = null;
  selfName = "";
  readonly self: Vec2 = { x: 0, y: 0 }; // predicted; refreshed by tick()
  readonly players = new Map<string, PlayerView>(); // remotes; positions interpolated by tick()
  readonly levers = new Map<string, LeverView>();
  readonly mobs = new Map<string, MobView>(); // non-players; positions interpolated by tick()
  /** Unified component store — ALL entities (self/remotes/mobs/levers) as render-ready data, refreshed each
   *  tick() from the netcode. A RenderSystem reads THIS (keyed by id) and mirrors it to views; neither client
   *  needs the per-type maps/events. (The per-type maps above remain as the netcode's working state.) */
  readonly entities = new Map<string, Entity>();
  /** Self health — server-authoritative (combat/respawn write it); read it for a health HUD. */
  selfHp = 0;
  selfMaxHp = 0;
  /** Last round-trip time to the server (ms, EMA-smoothed). Probed ~1×/sec; read it for a latency HUD. */
  ping = 0;
  /** Smoothed interval between server patches (ms) — ~50 at 20 Hz. Diagnostic: if this is ≫50 the server tick
   *  is starved, which (not the network) is what makes remotes lag. */
  patchMs = 0;
  /** Current interpolation-buffer size (ms) the SDK is applying — scales with patchMs. Diagnostic/HUD. */
  interpMs = 0;

  /** SDK-internal: the plain-data callbacks the transport projects a zone room through. */
  readonly handlers: ZoneHandlers;

  #zone?: ZoneConnection;
  readonly #clock = new ServerClock(250, 0.15); // snap on >250ms drift, otherwise track responsively
  readonly #predictor = new Predictor();
  readonly #interp = new Map<string, RemoteInterpolator>();
  readonly #mobInterp = new Map<string, RemoteInterpolator>();
  readonly #listeners = new Map<WorldEvent, Array<(...a: any[]) => void>>();
  #pingTimer?: ReturnType<typeof setInterval>;
  #lastPatchAt = 0;

  constructor(private readonly transport: Transport) {
    this.handlers = {
      onSelfSpawn: (x, y, name, hp, maxHp) => {
        this.selfName = name;
        this.selfHp = hp;
        this.selfMaxHp = maxHp;
        this.#predictor.spawn(x, y);
      },
      onSelfChange: (x, y, lastSeq, hp) => {
        this.selfHp = hp;
        this.#predictor.reconcile(x, y, lastSeq);
      },
      onRemoteAdd: (id, x, y, name) => {
        this.#interp.set(id, new RemoteInterpolator());
        this.players.set(id, { x, y, name });
        this.#emit("playerAdd", id, { x, y, name });
      },
      onRemoteRemove: (id) => {
        this.#interp.delete(id);
        this.players.delete(id);
        this.#emit("playerRemove", id);
      },
      onPatch: (serverT, remotes, mobs) => {
        const now = nowMs();
        if (this.#lastPatchAt) {
          const delta = now - this.#lastPatchAt;
          this.patchMs = this.patchMs ? Math.round(this.patchMs * 0.8 + delta * 0.2) : Math.round(delta);
        }
        this.#lastPatchAt = now;
        this.#clock.update(serverT, now);
        remotes.forEach((pos, id) => this.#interp.get(id)?.push({ t: serverT, x: pos.x, y: pos.y }));
        mobs.forEach((pos, id) => this.#mobInterp.get(id)?.push({ t: serverT, x: pos.x, y: pos.y }));
      },
      onLeverAdd: (id, x, y, on) => {
        this.levers.set(id, { x, y, on });
        this.#emit("leverAdd", id, { x, y, on });
      },
      onLeverChange: (id, on) => {
        const l = this.levers.get(id);
        if (l) {
          l.on = on;
          this.#emit("leverChange", id, l);
        }
      },
      onLeverRemove: (id) => {
        this.levers.delete(id);
        this.#emit("leverRemove", id);
      },
      onMobAdd: (id, m) => {
        this.#mobInterp.set(id, new RemoteInterpolator());
        this.mobs.set(id, { ...m });
        this.#emit("mobAdd", id, this.mobs.get(id));
      },
      onMobChange: (id, m) => {
        // Position rides the interpolator (onPatch); here we take the discrete fields the brain/combat change.
        const v = this.mobs.get(id);
        if (v) {
          v.kind = m.kind;
          v.level = m.level;
          v.hp = m.hp;
          v.maxHp = m.maxHp;
          v.action = m.action;
          this.#emit("mobChange", id, v);
        }
      },
      onMobRemove: (id) => {
        this.#mobInterp.delete(id);
        this.mobs.delete(id);
        this.#emit("mobRemove", id);
      },
      onMap: (worldId, map, assets) => {
        this.worldId = worldId;
        this.map = map;
        this.assets = assets ?? null; // the renderer reads world.assets in its "map" handler
        this.#emit("map", map);
      },
      onTransfer: (zoneId, reservation) => void this.#transferTo(zoneId, reservation),
      onPong: (sentAt) => {
        const rtt = nowMs() - sentAt;
        // Light EMA so the HUD reading is steady, not jittery; the first sample seeds it.
        this.ping = this.ping ? Math.round(this.ping * 0.8 + rtt * 0.2) : Math.round(rtt);
      },
    };
    // Mirror the server's authoritative collision in prediction (NOT a trust gate — the server still rejects
    // illegal moves). Uses the same isBodyWalkable + PLAYER_RADIUS the sim runs, against the map the client holds.
    this.#predictor.setCanWalk((x, y) => (this.map ? isBodyWalkable(this.map, x, y, PLAYER_RADIUS) : true));
  }

  /** SDK-internal: bind the first zone (called by Jupiter.enter once the transport has connected). */
  attach(zone: ZoneConnection, zoneId: string): void {
    this.#zone = zone;
    this.zoneId = zoneId;
    this.#startPing();
  }

  // Probe round-trip latency ~1×/sec, independent of render frames; onPong turns each echo into `ping`. The
  // timer outlives a portal transfer (it sends through whatever #zone is current) and is cleared on leave().
  #startPing(): void {
    if (this.#pingTimer) return; // started once on first attach; survives zone swaps
    const probe = (): void => {
      this.#zone?.sendPing(nowMs());
    };
    probe();
    this.#pingTimer = setInterval(probe, PING_INTERVAL_MS);
  }

  on(event: WorldEvent, cb: (...args: any[]) => void): void {
    const list = this.#listeners.get(event) ?? [];
    list.push(cb);
    this.#listeners.set(event, list);
  }
  #emit(event: WorldEvent, ...args: any[]): void {
    this.#listeners.get(event)?.forEach((cb) => cb(...args));
  }

  input(dx: number, dy: number, dt: number): void {
    this.#zone?.sendInput(this.#predictor.predict(dx, dy, dt));
  }
  interact(targetId: string): void {
    this.#zone?.sendInteract(targetId);
  }
  attack(targetId: string): void {
    this.#zone?.sendAttack(targetId);
  }

  // Jitter buffer sized to the measured patch cadence (~2.5 patches), clamped — scales with the zone's tickHz.
  #interpDelayMs(): number {
    const measured = this.patchMs ? this.patchMs * INTERP_PATCHES : INTERP_DEFAULT_MS;
    return Math.max(INTERP_MIN_MS, Math.min(INTERP_MAX_MS, measured));
  }

  /** Call once per render frame: refresh `self` (predicted) + `players` (interpolated on the server clock). */
  tick(): void {
    this.self.x = this.#predictor.x;
    this.self.y = this.#predictor.y;
    if (this.#clock.ready) {
      this.interpMs = Math.round(this.#interpDelayMs());
      const renderT = this.#clock.now(nowMs()) - this.interpMs;
      this.#interp.forEach((interp, id) => {
        const v = this.players.get(id);
        if (!v) return;
        const { x, y } = interp.sample(renderT);
        v.x = x;
        v.y = y;
        interp.prune(renderT);
      });
      this.#mobInterp.forEach((interp, id) => {
        const v = this.mobs.get(id);
        if (!v) return;
        const { x, y } = interp.sample(renderT);
        v.x = x;
        v.y = y;
        interp.prune(renderT);
      });
    }
    this.#refreshEntities();
  }

  // Rebuild the unified component store from the just-updated netcode state (self predicted, remotes/mobs
  // interpolated, levers static). RenderSystems read this each frame; keyed by id so view identity is stable.
  #refreshEntities(): void {
    this.entities.clear();
    this.entities.set(SELF_ID, {
      id: SELF_ID,
      kind: "player",
      x: this.self.x,
      y: this.self.y,
      name: this.selfName,
      hp: this.selfHp,
      maxHp: this.selfMaxHp,
      self: true,
    });
    this.players.forEach((p, id) => this.entities.set(id, { id, kind: "player", x: p.x, y: p.y, name: p.name }));
    this.levers.forEach((l, id) => this.entities.set(id, { id, kind: "lever", x: l.x, y: l.y, on: l.on }));
    this.mobs.forEach((m, id) =>
      this.entities.set(id, { id, kind: m.kind, x: m.x, y: m.y, hp: m.hp, maxHp: m.maxHp, action: m.action }),
    );
  }

  leave(): void {
    if (this.#pingTimer) clearInterval(this.#pingTimer);
    this.#pingTimer = undefined;
    this.#zone?.leave();
  }

  // Portal fired: consume the new reservation, swap the room, reset per-zone state, announce zoneChange.
  async #transferTo(zoneId: string, reservation: SeatReservation): Promise<void> {
    this.#zone?.leave();
    this.players.clear();
    this.levers.clear();
    this.mobs.clear();
    this.entities.clear();
    this.#interp.clear();
    this.#mobInterp.clear();
    this.#clock.reset();
    this.map = null;
    this.assets = null;
    this.#zone = await this.transport.consume(reservation, this.handlers);
    this.zoneId = zoneId;
    this.#emit("zoneChange", zoneId);
  }
}
