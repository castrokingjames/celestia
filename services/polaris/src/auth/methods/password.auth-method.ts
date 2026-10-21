// password.auth-method.ts — the "password" login method: username + a PER-USER password (unlike `basic`, which
// is username + ONE shared gate secret). The username is the stable external id; the password is hashed into
// auth_identity.secret_hash on FIRST login (login IS registration) and verified on return. Grants NO role —
// every login lands at 'terra' (G11). This is the SERVER half of the client "silent account" (the client
// generates + caches a random uid+password and auto-logs-in); the server can't tell a generated credential from
// a typed one, so the same method serves BQ's silent first-run AND a future human-chosen / IdP-linked upgrade.
import type { AuthMethod, VerifiedIdentity } from "../auth-method.port.js";
import { hashPassword, verifyPassword } from "./password-hash.js";

/** What the caller sends to POST /auth/password. */
export interface PasswordAuthInput {
  username: string;
  password: string;
}

function isPasswordAuthInput(v: unknown): v is PasswordAuthInput {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.username === "string" && typeof o.password === "string";
}

/** The narrow credential read this method needs — AUTHENTICATION-scoped (never account/role/privilege). */
export interface CredentialReader {
  getIdentitySecretHash(method: string, externalId: string): Promise<string | null>;
}

const MIN_PASSWORD_LEN = 8;

export class PasswordAuthMethod implements AuthMethod {
  readonly id = "password";
  readonly #pepper: string;
  readonly #credentials: CredentialReader;

  constructor(deps: { pepper: string; credentials: CredentialReader }) {
    if (!deps.pepper) throw new Error("PasswordAuthMethod requires an auth token pepper");
    this.#pepper = deps.pepper;
    this.#credentials = deps.credentials;
  }

  async complete(input: unknown): Promise<VerifiedIdentity> {
    if (!isPasswordAuthInput(input)) throw new Error("password auth: expected { username, password }");
    const username = input.username.trim();
    if (!username) throw new Error("password auth: empty username");
    // A floor only — the silent-account client generates a long random password, so this never bites it; it
    // guards a future human-chosen password. Upper bound guards against scrypt DoS via a megabyte "password".
    if (input.password.length < MIN_PASSWORD_LEN || input.password.length > 256) throw new Error("password auth: bad password length");

    // username is the stable external id; lower-cased so casing can't fork accounts (matches `basic`).
    const externalId = username.toLowerCase();
    const stored = await this.#credentials.getIdentitySecretHash(this.id, externalId);

    if (stored !== null) {
      // Returning login — verify against the stored hash. Mismatch throws; the controller maps it to a generic 401.
      if (!(await verifyPassword(input.password, stored, this.#pepper))) throw new Error("password auth: bad credentials");
      return { method: this.id, externalId, suggestedHandle: username };
    }

    // First login = registration — hash now; the core persists it into auth_identity.secret_hash on create.
    // (A concurrent first-login race for the SAME external id is resolved by the unique(method, external_id)
    // constraint + findOrCreateAccount's re-read; for client-generated random uids a collision is negligible.
    // When human-chosen usernames arrive, move verify+register into one transactional upsert to close the window.)
    const secretHash = await hashPassword(input.password, this.#pepper);
    return { method: this.id, externalId, suggestedHandle: username, secretHash };
  }
}
