// ticket.service.ts — the SHARED one-time ticket authority (EdDSA, jose). Polaris SIGNS the access badge; Atlas
// VERIFIES it offline, enforcing single-use via a per-process jti guard. The badge is the ONLY ticket in the
// system (the session + zone tickets are gone — one connection, one credential; REFACTOR.md S1). Private-key
// access is lazy, so a verify-only service (Atlas has no JWT_PRIVATE_KEY) never touches it. Claim shape +
// audience come from @celestia/norma — issuer and verifier can never drift (G7/G8).
import { Inject, Injectable } from "@nestjs/common";
import { SignJWT, jwtVerify, importPKCS8, importSPKI, type JWTPayload } from "jose";
import { randomUUID } from "node:crypto";
import { ACCESS_TICKET_AUD, type AccessTicketClaims } from "@celestia/norma";
import { ConfigService } from "../config/config.service.js";

const ALG = "EdDSA";

@Injectable()
export class TicketService {
  #priv?: ReturnType<typeof importPKCS8>;
  #pub?: ReturnType<typeof importSPKI>;
  readonly #usedJti = new Map<string, number>(); // jti -> expiry(ms); per-process one-time guard

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  #privateKey(): ReturnType<typeof importPKCS8> {
    return (this.#priv ??= importPKCS8(this.config.jwtPrivateKeyPem, ALG));
  }
  #publicKey(): ReturnType<typeof importSPKI> {
    return (this.#pub ??= importSPKI(this.config.jwtPublicKeyPem, ALG));
  }

  /** Polaris: mint the one-time ACCESS badge (aud=access) — the single credential the client carries to open
   *  its one Atlas connection (the Janus lobby). Replaces the session + zone tickets (REFACTOR.md S1). */
  async signAccessToken(claims: AccessTicketClaims, ttlSec: number): Promise<string> {
    return new SignJWT({ role: claims.role })
      .setProtectedHeader({ alg: ALG })
      .setSubject(claims.accountId)
      .setAudience(ACCESS_TICKET_AUD)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(`${ttlSec}s`)
      .sign(await this.#privateKey());
  }

  /** Atlas: verify + burn the access badge at the connection handshake (one badge → one connection). */
  async verifyAccessToken(token: string): Promise<AccessTicketClaims> {
    const { payload } = await jwtVerify(token, await this.#publicKey(), {
      algorithms: [ALG],
      audience: ACCESS_TICKET_AUD,
    });
    this.#burnJti(payload);
    if (typeof payload.sub !== "string" || typeof payload.role !== "string") {
      throw new Error("access badge missing sub/role");
    }
    return { accountId: payload.sub, role: payload.role };
  }

  // One-time enforcement: reject replay of a jti within its TTL (prune expired on the way).
  #burnJti(payload: JWTPayload): void {
    const now = Date.now();
    for (const [k, exp] of this.#usedJti) if (exp <= now) this.#usedJti.delete(k);
    if (typeof payload.jti === "string" && typeof payload.exp === "number") {
      if (this.#usedJti.has(payload.jti)) throw new Error("ticket already used");
      this.#usedJti.set(payload.jti, payload.exp * 1000);
    }
  }
}
