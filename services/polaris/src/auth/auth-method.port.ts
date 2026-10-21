// auth-method.port.ts — the seam that makes auth build-once.
//
// A login method implements this port; the auth CORE (account find-or-create + session
// issuance) never changes when you add Discord/Google/Steam/wallet — you add a new adapter.
// This is AUTHENTICATION ONLY ("who are you"), never AUTHORIZATION ("what may you do" -> allow()).
// A method NEVER issues sessions, NEVER touches accounts, NEVER decides permissions
// (guardrails #6 allow()-deny-by-default, #7 ports/adapters).

/** The verified result of a successful login, normalized across every method. */
export interface VerifiedIdentity {
  /** Which method produced this — matches auth_identity.method and AuthMethod.id. */
  readonly method: string;
  /** The STABLE external id from that method (-> auth_identity.external_id). */
  readonly externalId: string;
  /** Optional display-name hint, used only when first creating the account. */
  readonly suggestedHandle?: string;
  /** Optional per-identity secret to persist (-> auth_identity.secret_hash) ONLY when this is a first-login
   *  registration for a method that stores its own credential (e.g. `password`). Already-hashed by the method;
   *  the core persists it verbatim on create and never on an existing identity. Shared-secret methods (`basic`)
   *  and IdP methods (Discord/Google) omit it. */
  readonly secretHash?: string;
}

/** First leg for redirect-style methods (e.g. Discord OAuth): where to send the user. */
export interface AuthBeginResult {
  readonly redirectUrl: string;
  /** Opaque anti-CSRF value the caller round-trips back into complete(). */
  readonly state: string;
}

/**
 * A login method. Pure authentication: prove identity, return a VerifiedIdentity (or throw).
 *   - `begin?`  only for redirect flows; single-step methods (dev) omit it.
 *   - `complete` verifies the inbound credential/callback and yields the identity.
 * The concrete class is named only at the composition root — callers depend on this port.
 */
export interface AuthMethod {
  /** Stable id; matches auth_identity.method and config auth.enabledMethods[]. */
  readonly id: string;
  begin?(input: unknown): Promise<AuthBeginResult>;
  complete(input: unknown): Promise<VerifiedIdentity>;
}
