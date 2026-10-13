// ticket.ts — realtime verifies the one-time connect-ticket that meta minted (docs/AUTH.md).
// jose jwtVerify with the shared Ed25519 PUBLIC key (JWT_PUBLIC_KEY, base64 PEM) + aud=realtime,
// plus an in-memory one-time jti guard. The client is never trusted: it can't mint or alter a
// server-signed ticket (G11). NOTE: the jti guard is per-process — true multi-process one-time
// enforcement needs a shared store (Valkey), see docs/REALTIME.md §10.
import { jwtVerify, importSPKI } from "jose";
import { CONNECT_TICKET_AUD, type ConnectTicketClaims } from "@celestia/net-contract";

const ALG = "EdDSA";

function publicKeyPem(): string {
  const b64 = process.env.JWT_PUBLIC_KEY;
  if (!b64) throw new Error("realtime requires JWT_PUBLIC_KEY (base64 PEM) to verify connect-tickets");
  const pem = Buffer.from(b64, "base64").toString("utf8");
  if (!pem.includes("-----BEGIN")) throw new Error("JWT_PUBLIC_KEY must be base64-encoded PEM");
  return pem;
}

let keyPromise: ReturnType<typeof importSPKI> | undefined;
const publicKey = () => (keyPromise ??= importSPKI(publicKeyPem(), ALG));

// jti -> expiry(ms). Rejects replay of a ticket within its short TTL window.
const usedJti = new Map<string, number>();
function claimJti(jti: string, expSec: number): boolean {
  const now = Date.now();
  for (const [k, exp] of usedJti) if (exp <= now) usedJti.delete(k); // prune expired
  if (usedJti.has(jti)) return false;
  usedJti.set(jti, expSec * 1000);
  return true;
}

export async function verifyConnectTicket(ticket: string): Promise<ConnectTicketClaims> {
  const { payload } = await jwtVerify(ticket, await publicKey(), {
    algorithms: [ALG],
    audience: CONNECT_TICKET_AUD,
  });
  if (typeof payload.sub !== "string" || typeof payload.role !== "string") {
    throw new Error("connect-ticket missing sub/role");
  }
  if (typeof payload.jti === "string" && typeof payload.exp === "number") {
    if (!claimJti(payload.jti, payload.exp)) throw new Error("connect-ticket already used");
  }
  return { accountId: payload.sub, role: payload.role };
}
