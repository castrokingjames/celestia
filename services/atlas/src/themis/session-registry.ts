// themis/session-registry.ts — the authoritative map of account -> live Atlas connection, formalizing the
// in-process `live` Map the Janus lobby used to hold at module scope. @Injectable so both the lobby and the
// zone room share ONE instance (DI singleton). Enforces the one-session-per-account invariant (a new connect
// DISPLACES the old, code 4409) and is the kick surface the Themis revocation sweep calls. Connections are
// typed structurally (Kickable) so this stays unit-testable without a Colyseus server. Cross-process reach
// (multi-instance) is the deferred Valkey/Presence seam — this covers the single process we run today.
import { Injectable } from "@nestjs/common";

/** The slice of a Colyseus Client this needs — a real Client satisfies it structurally. */
export interface Kickable {
  readonly sessionId: string;
  leave(code?: number): void;
}

const CODE_DISPLACED = 4409; // "logged in elsewhere" — one session per account
const CODE_REVOKED = 4403; // "account not active" — ban/suspend eviction

@Injectable()
export class SessionRegistry {
  readonly #byAccount = new Map<string, Kickable>();

  /** Register a connection for an account; a new connection displaces the old (4409). Idempotent for the
   *  same connection (matched by sessionId). */
  register(accountId: string, client: Kickable): void {
    const existing = this.#byAccount.get(accountId);
    if (existing && existing.sessionId !== client.sessionId) existing.leave(CODE_DISPLACED);
    this.#byAccount.set(accountId, client);
  }

  /** Drop a connection only if it is still the registered one — ignores a stale leave after displacement. */
  remove(accountId: string, client: Kickable): void {
    if (this.#byAccount.get(accountId)?.sessionId === client.sessionId) this.#byAccount.delete(accountId);
  }

  /** Evict the account's live connection (ban/revocation). No-op if it is not connected to this process. */
  kick(accountId: string, code: number = CODE_REVOKED): void {
    const client = this.#byAccount.get(accountId);
    if (!client) return;
    client.leave(code);
    this.#byAccount.delete(accountId);
  }

  /** Account ids with a live connection in this process — the revocation sweep's input. */
  accountIds(): string[] {
    return [...this.#byAccount.keys()];
  }
}
