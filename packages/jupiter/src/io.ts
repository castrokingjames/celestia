// jupiter/io.ts — IO, the auth leg: REST login → the one access badge (G11; no reusable access token). The
// only HTTP the SDK does; everything after is the Atlas connection (europa).
export interface Credentials {
  polarisUrl: string;
  username: string;
  secret: string;
}

export interface Session {
  refreshToken: string;
  accessBadge: string;
  account: { id: string; role: string; handle: string | null };
}

/** Credentials for the `password` method (username + per-user password — the silent-account flow). */
export interface PasswordCredentials {
  polarisUrl: string;
  username: string;
  password: string;
}

async function postLogin(url: string, payload: Record<string, string>): Promise<Session> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`login failed (${res.status})`);
  const body = (await res.json()) as {
    session: { refreshToken: string; accessBadge: string };
    account: { id: string; role: string; handle: string | null };
  };
  return { refreshToken: body.session.refreshToken, accessBadge: body.session.accessBadge, account: body.account };
}

/** Log in via the basic method (shared gate secret; login == registration). Returns the rotating refresh + the
 *  one-time access badge. A banned/suspended account gets 403. */
export async function login(c: Credentials): Promise<Session> {
  return postLogin(`${c.polarisUrl}/auth/basic`, { username: c.username, secret: c.secret });
}

/** Log in via the password method (username + per-user password; first login auto-registers). Same Session shape. */
export async function loginPassword(c: PasswordCredentials): Promise<Session> {
  return postLogin(`${c.polarisUrl}/auth/password`, { username: c.username, password: c.password });
}
