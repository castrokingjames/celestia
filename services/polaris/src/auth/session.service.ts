// session.service.ts — session-first (docs/AUTH.md Decision P1.5; collapsed to ONE access badge per
// docs/REFACTOR.md S1). Issues/refreshes = { refresh (opaque, rotating, pepper-HMAC at rest), accessBadge
// (one-time EdDSA JWT, aud=access) }. The client is handed NO reusable access token — the badge opens the ONE
// Atlas connection (the Janus lobby), after which the connection is the auth surface. Badge SIGNING is
// delegated to the shared TicketService; this service owns the refresh lifecycle (rotation, reuse-detection,
// ban-on-refresh). Framework-agnostic: depends on the one Repository + a badge signer, wired at the
// composition root (never Kysely — G7).
import { createHmac, randomBytes } from "node:crypto";
import type { TicketService } from "@celestia/firmament/nest";
import type { Account, Repository } from "@celestia/firmament";

/** A login/refresh was attempted for a non-active (suspended/banned) account — refused by the status gate. */
export class AccountNotActiveError extends Error {
  constructor() {
    super("account is not active");
    this.name = "AccountNotActiveError";
  }
}

export interface SessionResult {
  readonly refreshToken: string; // raw, opaque — returned to the client ONCE
  readonly refreshExpiresInSec: number;
  readonly accessBadge: string; // one-time JWT (aud=access) — opens the one Atlas connection, then is burned
  readonly accessBadgeExpiresInSec: number;
}

/** Only the refresh + account reads this service needs — narrowed so tests can stub it. */
type SessionRepo = Pick<
  Repository,
  | "createRefresh"
  | "findRefreshByHash"
  | "rotateRefresh"
  | "revokeRefreshByHash"
  | "revokeAllRefreshForAccount"
  | "getAccountById"
>;

export interface SessionDeps {
  readonly pepper: string;
  readonly refreshTtlSec: number;
  readonly accessTicketTtlSec: number;
  readonly repo: SessionRepo;
  // Only the signing half is needed here; typed structurally so the service stays test-stubbable.
  readonly tickets: Pick<TicketService, "signAccessToken">;
}

export class SessionService {
  constructor(private readonly deps: SessionDeps) {}

  #hashRefresh(raw: string): string {
    return createHmac("sha256", this.deps.pepper).update(raw).digest("hex");
  }

  async #mintRefresh(accountId: string): Promise<string> {
    const raw = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.deps.refreshTtlSec * 1000);
    await this.deps.repo.createRefresh(accountId, this.#hashRefresh(raw), expiresAt);
    return raw;
  }

  async #session(account: { id: string; role: string }, refreshToken: string): Promise<SessionResult> {
    const accessBadge = await this.deps.tickets.signAccessToken(
      { accountId: account.id, role: account.role },
      this.deps.accessTicketTtlSec,
    );
    return {
      refreshToken,
      refreshExpiresInSec: this.deps.refreshTtlSec,
      accessBadge,
      accessBadgeExpiresInSec: this.deps.accessTicketTtlSec,
    };
  }

  /** Issue a fresh session for an already-authenticated account. A non-active (suspended/banned) account is
   *  refused BEFORE any refresh is minted — the ban takes effect at login, not just at refresh (G11). */
  async issue(account: { id: string; role: string; status: string }): Promise<SessionResult> {
    if (account.status !== "active") throw new AccountNotActiveError();
    return this.#session(account, await this.#mintRefresh(account.id));
  }

  /** Exchange a refresh token: rotate it + mint a new session. Role is re-read from the DB (a demotion
   *  takes effect at refresh); replaying a spent token burns the whole chain; a non-active account is
   *  refused (ban-takes-effect-on-refresh). */
  async refresh(rawRefresh: string): Promise<{ session: SessionResult; account: Account }> {
    const rec = await this.deps.repo.findRefreshByHash(this.#hashRefresh(rawRefresh));
    if (!rec) throw new Error("refresh token not recognized");
    if (rec.revokedAt || rec.rotatedTo) {
      await this.deps.repo.revokeAllRefreshForAccount(rec.accountId); // reuse/theft → burn the chain
      throw new Error("refresh token reuse detected");
    }
    if (rec.expiresAt.getTime() <= Date.now()) throw new Error("refresh token expired");

    const account = await this.deps.repo.getAccountById(rec.accountId);
    if (!account) throw new Error("account no longer exists");
    if (account.status !== "active") {
      await this.deps.repo.revokeAllRefreshForAccount(account.id); // ban landed mid-chain → burn it
      throw new AccountNotActiveError();
    }

    const raw = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.deps.refreshTtlSec * 1000);
    await this.deps.repo.rotateRefresh(rec.id, account.id, this.#hashRefresh(raw), expiresAt);
    return { session: await this.#session(account, raw), account };
  }

  /** Log a session out by revoking its refresh token (idempotent). The live Atlas connection is dropped
   *  separately; the access badge is one-time and short-lived. */
  async logout(rawRefresh: string): Promise<void> {
    await this.deps.repo.revokeRefreshByHash(this.#hashRefresh(rawRefresh));
  }
}
