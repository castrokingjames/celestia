// session.ts — Celestia client SDK (session-first, docs/AUTH.md P1.5 + docs/CHARACTERS.md §4-5). login()
// over REST yields a one-time session ticket; SessionConnection opens the ONE bound session (WS) to Polaris
// and carries the pre-world messages (session.state push, character.create, play.enter -> zone ticket). The
// game calls this, never raw HTTP/WS. Isomorphic: global fetch + WebSocket (browser + Node 22+).
import {
  SESSION_MSG,
  type CharacterSummary,
  type PlayEnterResult,
  type SessionStateMsg,
} from "@celestia/norma";

export interface LoginResult {
  refreshToken: string;
  sessionTicket: string;
}

/** Log in via the basic method (login == registration). Returns the rotating refresh + one-time session
 *  ticket — there is NO reusable access token (G11 / P1.5). */
export async function login(polarisHttpUrl: string, username: string, secret: string): Promise<LoginResult> {
  const res = await fetch(`${polarisHttpUrl}/auth/basic`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, secret }),
  });
  if (!res.ok) throw new Error(`login failed (${res.status})`);
  const body = await res.json();
  return { refreshToken: body.session.refreshToken, sessionTicket: body.session.sessionTicket };
}

/** The one bound session to Polaris — the connection-capped auth surface. */
export class SessionConnection {
  #ws: WebSocket;
  #onState?: (state: SessionStateMsg) => void;
  #enterResolvers: Array<(r: PlayEnterResult) => void> = [];

  constructor(polarisWsUrl: string, sessionTicket: string) {
    this.#ws = new WebSocket(`${polarisWsUrl}/?ticket=${encodeURIComponent(sessionTicket)}`);
    this.#ws.onmessage = (ev: MessageEvent) => {
      const msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
      if (msg.event === SESSION_MSG.state) this.#onState?.(msg.data as SessionStateMsg);
      else if (msg.event === SESSION_MSG.playEnter) this.#enterResolvers.shift()?.(msg.data as PlayEnterResult);
    };
  }

  /** Resolves once the session is open (ticket accepted). */
  ready(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#ws.onopen = () => resolve();
      this.#ws.onerror = () => reject(new Error("session connection failed"));
    });
  }

  /** Fires on every session.state the server pushes (on connect + after character.create). */
  onState(cb: (state: SessionStateMsg) => void): void {
    this.#onState = cb;
  }

  create(name: string): void {
    this.#ws.send(JSON.stringify({ event: SESSION_MSG.characterCreate, data: { name } }));
  }

  /** Enter the world as a character -> resolves with the zone + one-time zone ticket for Atlas. */
  enter(characterId: string): Promise<PlayEnterResult> {
    return new Promise((resolve) => {
      this.#enterResolvers.push(resolve);
      this.#ws.send(JSON.stringify({ event: SESSION_MSG.playEnter, data: { characterId } }));
    });
  }

  close(): void {
    this.#ws.close();
  }
}

export type { CharacterSummary, PlayEnterResult, SessionStateMsg };
