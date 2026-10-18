// jupiter/world.ts — the game-facing WORLD. Combines the transport (europa) with the netcode (ganymede) and
// exposes PLAIN DATA + events: NO colyseus, NO renderer. Any frontend (Phaser, React, vanilla, headless)
// drives it the same way: read `self`/`players`/`levers`/`map`, call `input`/`interact`, `tick()` once per
// render frame, and subscribe to `on(...)`. It owns prediction (self), interpolation (remotes), the server
// clock, and the portal-transfer room swap — all hidden behind this surface.
import type { SeatReservation, ZoneMapWire } from "@celestia/norma";
import type { Transport, ZoneConnection, ZoneHandlers } from "./europa.js";
import { Predictor } from "./ganymede/predictor.js";
import { RemoteInterpolator } from "./ganymede/interpolator.js";
import { ServerClock } from "./ganymede/server-clock.js";

export type Vec2 = { x: number; y: number };
export type PlayerView = { x: number; y: number; name: string };
export type LeverView = { x: number; y: number; on: boolean };
export type WorldEvent =
  | "map"
  | "playerAdd"
  | "playerRemove"
  | "leverAdd"
  | "leverChange"
  | "leverRemove"
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
  selfName = "";
  readonly self: Vec2 = { x: 0, y: 0 }; // predicted; refreshed by tick()
  readonly players = new Map<string, PlayerView>(); // remotes; positions interpolated by tick()
  readonly levers = new Map<string, LeverView>();
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
  readonly #listeners = new Map<WorldEvent, Array<(...a: any[]) => void>>();
  #pingTimer?: ReturnType<typeof setInterval>;
  #lastPatchAt = 0;

  constructor(private readonly transport: Transport) {
    this.handlers = {
      onSelfSpawn: (x, y, name) => {
        this.selfName = name;
        this.#predictor.spawn(x, y);
      },
      onSelfChange: (x, y, lastSeq) => this.#predictor.reconcile(x, y, lastSeq),
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
      onPatch: (serverT, remotes) => {
        const now = nowMs();
        if (this.#lastPatchAt) {
          const delta = now - this.#lastPatchAt;
          this.patchMs = this.patchMs ? Math.round(this.patchMs * 0.8 + delta * 0.2) : Math.round(delta);
        }
        this.#lastPatchAt = now;
        this.#clock.update(serverT, now);
        remotes.forEach((pos, id) => this.#interp.get(id)?.push({ t: serverT, x: pos.x, y: pos.y }));
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
      onMap: (worldId, map) => {
        this.worldId = worldId;
        this.map = map;
        this.#emit("map", map);
      },
      onTransfer: (zoneId, reservation) => void this.#transferTo(zoneId, reservation),
      onPong: (sentAt) => {
        const rtt = nowMs() - sentAt;
        // Light EMA so the HUD reading is steady, not jittery; the first sample seeds it.
        this.ping = this.ping ? Math.round(this.ping * 0.8 + rtt * 0.2) : Math.round(rtt);
      },
    };
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

  // Jitter buffer sized to the measured patch cadence (~2.5 patches), clamped — scales with the zone's tickHz.
  #interpDelayMs(): number {
    const measured = this.patchMs ? this.patchMs * INTERP_PATCHES : INTERP_DEFAULT_MS;
    return Math.max(INTERP_MIN_MS, Math.min(INTERP_MAX_MS, measured));
  }

  /** Call once per render frame: refresh `self` (predicted) + `players` (interpolated on the server clock). */
  tick(): void {
    this.self.x = this.#predictor.x;
    this.self.y = this.#predictor.y;
    if (!this.#clock.ready) return;
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
    this.#interp.clear();
    this.#clock.reset();
    this.map = null;
    this.#zone = await this.transport.consume(reservation, this.handlers);
    this.zoneId = zoneId;
    this.#emit("zoneChange", zoneId);
  }
}
