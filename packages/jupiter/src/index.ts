// @celestia/jupiter — the client SDK facade (docs/CLIENT-SDK.md §1: "there is ONE thing the game touches").
// A game does: new Jupiter(cfg) → login() → enter() → drive the returned World. It never imports colyseus, a
// token, or a wss URL. Internals: io (auth) · europa (transport, owns colyseus) · ganymede (netcode) · world
// (facade) · metis (the @celestia/norma wire contract). The Godot/GDScript Jupiter is the parallel embodiment
// on the same norma contract.
import { Transport } from "./europa.js";
import { World } from "./world.js";
import { login, loginPassword, type Session } from "./io.js";
import { resolveSilentCredentials, type CredentialStore } from "./identity.js";

export { World } from "./world.js";
export type { Vec2, PlayerView, LeverView, MobView, Entity, WorldEvent } from "./world.js";
export type { Session, Credentials, PasswordCredentials } from "./io.js";
export type { CredentialStore, SilentCredential } from "./identity.js";
export { generateSilentCredential, resolveSilentCredentials } from "./identity.js";
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

  /** REST login via the basic method (shared gate secret) → the one access badge (held for enter()). Throws on
   *  bad credentials / banned (403). */
  async login(username: string, secret: string): Promise<Session> {
    this.#session = await login({ polarisUrl: this.cfg.polarisUrl, username, secret });
    return this.#session;
  }

  /** REST login via the password method (username + per-user password; first login auto-registers). */
  async loginPassword(username: string, password: string): Promise<Session> {
    this.#session = await loginPassword({ polarisUrl: this.cfg.polarisUrl, username, password });
    return this.#session;
  }

  /** Silent-account login: read the device-cached uid+password (or generate + persist one on first run via the
   *  supplied CredentialStore), then log in via the password method. The returnable, zero-friction first-run flow
   *  (BrowserQuest-style); pair with enter(promptForName) to name the character on first creation. */
  async loginSilent(store: CredentialStore): Promise<Session> {
    const { username, password } = resolveSilentCredentials(store);
    return this.loginPassword(username, password);
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
