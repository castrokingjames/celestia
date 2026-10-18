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

/** Log in via the basic method (login == registration). Returns the rotating refresh + the one-time access
 *  badge. A banned/suspended account gets 403. */
export async function login(c: Credentials): Promise<Session> {
  const res = await fetch(`${c.polarisUrl}/auth/basic`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: c.username, secret: c.secret }),
  });
  if (!res.ok) throw new Error(`login failed (${res.status})`);
  const body = (await res.json()) as {
    session: { refreshToken: string; accessBadge: string };
    account: { id: string; role: string; handle: string | null };
  };
  return { refreshToken: body.session.refreshToken, accessBadge: body.session.accessBadge, account: body.account };
}
