// auth.ts — the first slice of the Celestia client SDK: auth. The GAME calls this, never raw
// HTTP/colyseus. Flow: login (==registration) -> hold the session -> exchange for a one-time
// connect-ticket to hand the realtime server. (The fuller SDK — state mirror, intents — comes later;
// docs/CLIENT-SDK.md.) Uses fetch, which exists in both the browser and Node 22 (the smoke script).

export interface Session {
  accessToken: string;
  refreshToken: string;
  accessExpiresInSec: number;
  refreshExpiresInSec: number;
}

export interface AccountView {
  id: string;
  role: string;
  handle: string | null;
}

export class CelestiaAuth {
  #session?: Session;

  constructor(private readonly metaUrl: string) {}

  /** Log in via the basic method (login == registration). Stores the session for connectTicket(). */
  async login(username: string, secret: string): Promise<{ account: AccountView; created: boolean }> {
    const res = await fetch(`${this.metaUrl}/auth/basic`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, secret }),
    });
    if (!res.ok) throw new Error(`login failed (${res.status})`);
    const body = await res.json();
    this.#session = body.session;
    return { account: body.account, created: body.created };
  }

  /** Exchange the current access token for a one-time connect-ticket for the realtime server. */
  async connectTicket(): Promise<string> {
    if (!this.#session) throw new Error("not logged in");
    const res = await fetch(`${this.metaUrl}/auth/ticket`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.#session.accessToken}` },
    });
    if (!res.ok) throw new Error(`connect-ticket failed (${res.status})`);
    return (await res.json()).ticket as string;
  }

  get session(): Session | undefined {
    return this.#session;
  }
}
