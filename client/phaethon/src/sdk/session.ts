// session.ts — Celestia client SDK (badge-first; docs/REFACTOR.md S1). login() over REST yields the ONE access
// badge; the client then opens a SINGLE Colyseus connection to Atlas and joins the Janus lobby with that badge
// (onAuth verifies + burns it). The lobby carries the pre-world messages (session.state push, character.create,
// play.enter → a seat reservation). The game consumes the reservation to join a zone room — no second ticket,
// no second connection to a different server. Isomorphic: global fetch + colyseus.js (browser + Node 22+).
import { Client, type Room } from "colyseus.js";
import { SESSION_MSG, type PlayEnterResult, type SessionStateMsg } from "@celestia/norma";

export interface LoginResult {
  refreshToken: string;
  accessBadge: string;
  account: { id: string; role: string; handle: string | null };
}

/** Log in via the basic method (login == registration). Returns the rotating refresh + the one-time access
 *  badge — there is NO reusable access token (G11). A banned/suspended account gets 403. */
export async function login(polarisHttpUrl: string, username: string, secret: string): Promise<LoginResult> {
  const res = await fetch(`${polarisHttpUrl}/auth/basic`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, secret }),
  });
  if (!res.ok) throw new Error(`login failed (${res.status})`);
  const body = await res.json();
  return { refreshToken: body.session.refreshToken, accessBadge: body.session.accessBadge, account: body.account };
}

/** The Janus lobby over Colyseus — the one Atlas connection, opened with the access badge. */
export class Lobby {
  #room: Room;
  #onState?: (state: SessionStateMsg) => void;
  #enterResolvers: Array<(r: PlayEnterResult) => void> = [];

  private constructor(room: Room) {
    this.#room = room;
    room.onMessage(SESSION_MSG.state, (state: SessionStateMsg) => this.#onState?.(state));
    room.onMessage(SESSION_MSG.playEnter, (result: PlayEnterResult) => this.#enterResolvers.shift()?.(result));
    room.onMessage("error", (err: { of?: string; reason?: string }) =>
      console.warn("[lobby] server error:", err?.of, err?.reason),
    );
  }

  /** Open the lobby: one Colyseus connection to Atlas, authenticated by the badge. */
  static async open(client: Client, badge: string): Promise<Lobby> {
    const room = await client.joinOrCreate("lobby", { badge });
    return new Lobby(room);
  }

  /** Fires on every session.state the server pushes (on join + after character.create). */
  onState(cb: (state: SessionStateMsg) => void): void {
    this.#onState = cb;
  }

  create(name: string): void {
    this.#room.send(SESSION_MSG.characterCreate, { name });
  }

  /** Enter the world as a character → resolves with the zone + the seat reservation to consume. */
  enter(characterId: string): Promise<PlayEnterResult> {
    return new Promise((resolve) => {
      this.#enterResolvers.push(resolve);
      this.#room.send(SESSION_MSG.playEnter, { characterId });
    });
  }

  leave(): void {
    void this.#room.leave();
  }
}

export type { PlayEnterResult, SessionStateMsg };
