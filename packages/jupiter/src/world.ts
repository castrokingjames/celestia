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

const INTERP_DELAY_MS = 300; // render remotes this far behind the server clock (jitter buffer)
const nowMs = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

export class World {
  zoneId = "";
  map: ZoneMapWire | null = null;
  selfName = "";
  readonly self: Vec2 = { x: 0, y: 0 }; // predicted; refreshed by tick()
  readonly players = new Map<string, PlayerView>(); // remotes; positions interpolated by tick()
  readonly levers = new Map<string, LeverView>();

  /** SDK-internal: the plain-data callbacks the transport projects a zone room through. */
  readonly handlers: ZoneHandlers;

  #zone?: ZoneConnection;
  readonly #clock = new ServerClock();
  readonly #predictor = new Predictor();
  readonly #interp = new Map<string, RemoteInterpolator>();
  readonly #listeners = new Map<WorldEvent, Array<(...a: any[]) => void>>();

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
        this.#clock.update(serverT, nowMs());
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
      onMap: (map) => {
        this.map = map;
        this.#emit("map", map);
      },
      onTransfer: (zoneId, reservation) => void this.#transferTo(zoneId, reservation),
    };
  }

  /** SDK-internal: bind the first zone (called by Jupiter.enter once the transport has connected). */
  attach(zone: ZoneConnection, zoneId: string): void {
    this.#zone = zone;
    this.zoneId = zoneId;
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

  /** Call once per render frame: refresh `self` (predicted) + `players` (interpolated on the server clock). */
  tick(): void {
    this.self.x = this.#predictor.x;
    this.self.y = this.#predictor.y;
    if (!this.#clock.ready) return;
    const renderT = this.#clock.now(nowMs()) - INTERP_DELAY_MS;
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
