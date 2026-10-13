// basic.auth-method.ts — the "basic" login method (username + shared gate secret), the first
// AuthMethod adapter. A local, non-redirect stand-in so the whole pipeline is testable before a
// real IdP exists (CI, the POC, local/internal use). The username IS the external identity;
// BASIC_AUTH_SECRET gates ACCESS to the method so sessions can't be freely minted — it grants NO
// role (G11): every login lands at 'terra'. NOT for production — availability is controlled by
// config auth.enabledMethods (['basic'] in non-prod). Discord/Google/wallet land as sibling
// adapters without this file (or the core) changing — that is the point of the port.
import { createHash, timingSafeEqual } from "node:crypto";
import type { AuthMethod, VerifiedIdentity } from "../auth-method.port.js";

/** What the caller sends to the basic login endpoint. */
export interface BasicAuthInput {
  username: string;
  secret: string;
}

function isBasicAuthInput(v: unknown): v is BasicAuthInput {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.username === "string" && typeof o.secret === "string";
}

export class BasicAuthMethod implements AuthMethod {
  readonly id = "basic";
  // Pre-hashed to a fixed 32-byte digest so the compare is constant-length (no secret-length leak).
  readonly #secretDigest: Buffer;

  constructor(secret: string) {
    if (!secret) throw new Error("BasicAuthMethod requires BASIC_AUTH_SECRET");
    this.#secretDigest = createHash("sha256").update(secret).digest();
  }

  async complete(input: unknown): Promise<VerifiedIdentity> {
    if (!isBasicAuthInput(input)) throw new Error("basic auth: expected { username, secret }");

    const provided = createHash("sha256").update(input.secret).digest();
    if (!timingSafeEqual(this.#secretDigest, provided)) throw new Error("basic auth: bad secret");

    const username = input.username.trim();
    if (!username) throw new Error("basic auth: empty username");

    // username is the stable external id; normalized lower-case so casing can't fork accounts.
    return { method: this.id, externalId: username.toLowerCase(), suggestedHandle: username };
  }
}
