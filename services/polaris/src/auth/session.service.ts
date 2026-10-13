// session.service.ts — issues and refreshes sessions. Two halves:
//   access  = stateless EdDSA JWT (jose), short-lived; claims { sub: account_id, role } where role
//             is read from AUTHORITATIVE state, never client input (G11).
//   refresh = opaque random token, long-lived, ROTATING; only its pepper-HMAC is stored, never the
//             raw. Exchanging it rotates (old revoked); replaying an already-rotated/revoked token
//             is treated as theft and burns the account's whole refresh chain.
// Framework-agnostic: depends on the RefreshStore + AccountStore ports, wired at the composition root.
import { SignJWT, jwtVerify, importPKCS8, importSPKI } from "jose";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { CONNECT_TICKET_AUD } from "@celestia/net-contract";
import type { Account, AccountStore } from "../accounts/account.store.js";
import type { RefreshStore } from "./refresh.store.js";

const ALG = "EdDSA";

export interface SessionTokens {
  readonly accessToken: string;
  readonly refreshToken: string; // raw, opaque — returned to the client ONCE
  readonly accessExpiresInSec: number;
  readonly refreshExpiresInSec: number;
}

export interface AccessClaims {
  readonly sub: string; // account id
  readonly role: string;
}

export interface SessionDeps {
  readonly privateKeyPem: string;
  readonly publicKeyPem: string;
  readonly pepper: string;
  readonly accessTtlSec: number;
  readonly refreshTtlSec: number;
  readonly connectTicketTtlSec: number;
  readonly refreshStore: RefreshStore;
  readonly accounts: AccountStore;
}

export class SessionService {
  #priv?: Awaited<ReturnType<typeof importPKCS8>>;
  #pub?: Awaited<ReturnType<typeof importSPKI>>;

  constructor(private readonly deps: SessionDeps) {}

  async #privateKey() {
    return (this.#priv ??= await importPKCS8(this.deps.privateKeyPem, ALG));
  }
  async #publicKey() {
    return (this.#pub ??= await importSPKI(this.deps.publicKeyPem, ALG));
  }

  #hashRefresh(raw: string): string {
    return createHmac("sha256", this.deps.pepper).update(raw).digest("hex");
  }

  async #mintAccess(account: { id: string; role: string }): Promise<string> {
    return new SignJWT({ role: account.role })
      .setProtectedHeader({ alg: ALG })
      .setSubject(account.id)
      .setIssuedAt()
      .setExpirationTime(`${this.deps.accessTtlSec}s`)
      .sign(await this.#privateKey());
  }

  async #mintRefresh(accountId: string): Promise<string> {
    const raw = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.deps.refreshTtlSec * 1000);
    await this.deps.refreshStore.create(accountId, this.#hashRefresh(raw), expiresAt);
    return raw;
  }

  #tokens(accessToken: string, refreshToken: string): SessionTokens {
    return {
      accessToken,
      refreshToken,
      accessExpiresInSec: this.deps.accessTtlSec,
      refreshExpiresInSec: this.deps.refreshTtlSec,
    };
  }

  /** Issue a fresh session for an already-authenticated account. */
  async issue(account: { id: string; role: string }): Promise<SessionTokens> {
    const accessToken = await this.#mintAccess(account);
    const refreshToken = await this.#mintRefresh(account.id);
    return this.#tokens(accessToken, refreshToken);
  }

  /** Mint a one-time, short-TTL connect-ticket (EdDSA JWT, aud=realtime) that realtime verifies in
   *  onAuth. Carries sub=account_id + role + a jti so realtime can enforce single use. */
  async issueConnectTicket(account: { id: string; role: string }): Promise<{ ticket: string; expiresInSec: number }> {
    const ticket = await new SignJWT({ role: account.role })
      .setProtectedHeader({ alg: ALG })
      .setSubject(account.id)
      .setAudience(CONNECT_TICKET_AUD)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(`${this.deps.connectTicketTtlSec}s`)
      .sign(await this.#privateKey());
    return { ticket, expiresInSec: this.deps.connectTicketTtlSec };
  }

  /** Verify an access token's signature + shape; returns its claims or throws. */
  async verifyAccess(token: string): Promise<AccessClaims> {
    const { payload } = await jwtVerify(token, await this.#publicKey(), { algorithms: [ALG] });
    if (typeof payload.sub !== "string" || typeof payload.role !== "string") {
      throw new Error("access token missing sub/role");
    }
    return { sub: payload.sub, role: payload.role };
  }

  /** Exchange a refresh token: rotate it and mint a new session. Role is re-read from the DB so a
   *  demotion takes effect at refresh. Replaying a spent token revokes the whole chain. */
  async refresh(rawRefresh: string): Promise<{ tokens: SessionTokens; account: Account }> {
    const rec = await this.deps.refreshStore.findByHash(this.#hashRefresh(rawRefresh));
    if (!rec) throw new Error("refresh token not recognized");
    if (rec.revokedAt || rec.rotatedTo) {
      // Spent token presented again = reuse/theft → burn every live token for the account.
      await this.deps.refreshStore.revokeAllForAccount(rec.accountId);
      throw new Error("refresh token reuse detected");
    }
    if (rec.expiresAt.getTime() <= Date.now()) throw new Error("refresh token expired");

    const account = await this.deps.accounts.getById(rec.accountId);
    if (!account) throw new Error("account no longer exists");
    if (account.status !== "active") {
      // ban/suspension takes effect at refresh: kill the chain so no new access can be minted.
      // (The current access JWT still lives until its short exp — stateless tokens can't be recalled.)
      await this.deps.refreshStore.revokeAllForAccount(account.id);
      throw new Error("account is not active");
    }

    const raw = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.deps.refreshTtlSec * 1000);
    await this.deps.refreshStore.rotate(rec.id, account.id, this.#hashRefresh(raw), expiresAt);
    const accessToken = await this.#mintAccess(account);
    return { tokens: this.#tokens(accessToken, raw), account };
  }

  /** Log a session out by revoking its refresh token (idempotent — no-op if unknown/already dead).
   *  Access tokens are stateless, so an already-issued access JWT stays valid until it expires
   *  (<= accessTtlSec); logout stops any NEW access from being minted off this refresh. */
  async logout(rawRefresh: string): Promise<void> {
    await this.deps.refreshStore.revokeByHash(this.#hashRefresh(rawRefresh));
  }
}
