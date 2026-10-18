// @celestia/jupiter — the client SDK facade (docs/CLIENT-SDK.md §1: "there is ONE thing the game touches").
// A game does: new Jupiter(cfg) → login() → enter() → drive the returned World. It never imports colyseus, a
// token, or a wss URL. Internals: io (auth) · europa (transport, owns colyseus) · ganymede (netcode) · world
// (facade) · metis (the @celestia/norma wire contract). The Godot/GDScript Jupiter is the parallel embodiment
// on the same norma contract.
import { Transport } from "./europa.js";
import { World } from "./world.js";
import { login, type Session } from "./io.js";

export { World } from "./world.js";
export type { Vec2, PlayerView, LeverView, WorldEvent } from "./world.js";
export type { Session, Credentials } from "./io.js";
export * from "./metis.js"; // the wire contract (ZoneMapWire, intent types, …)

export interface JupiterConfig {
  polarisUrl: string;
  atlasUrl: string;
}

export class Jupiter {
  readonly #transport: Transport;
  #session?: Session;

  constructor(private readonly cfg: JupiterConfig) {
    this.#transport = new Transport(cfg.atlasUrl);
  }

  /** REST login → the one access badge (held for enter()). Throws on bad credentials / banned (403). */
  async login(username: string, secret: string): Promise<Session> {
    this.#session = await login({ polarisUrl: this.cfg.polarisUrl, username, secret });
    return this.#session;
  }

  /** Enter the world: Janus lobby → auto-select the first character (create one — named by `chooseName` — if
   *  none) → the zone. Returns the live World the game reads + drives. Call login() first. */
  async enter(chooseName: () => string = defaultName): Promise<World> {
    if (!this.#session) throw new Error("call login() before enter()");
    const world = new World(this.#transport);
    const { zone, zoneId } = await this.#transport.enter(this.#session.accessBadge, chooseName, world.handlers);
    world.attach(zone, zoneId);
    return world;
  }
}

function defaultName(): string {
  return `Hero_${Math.random().toString(36).slice(2, 7)}`;
}
