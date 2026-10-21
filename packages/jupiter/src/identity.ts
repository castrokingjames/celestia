// jupiter/identity.ts — the "silent account" credential layer (client half of the `password` auth method).
// On first run the SDK generates a random uid + password, hands them to a platform CredentialStore to persist,
// and logs in with them (login == registration server-side). Every later run re-reads the cached credential and
// auto-logs-in. DOM-agnostic: the SDK owns the algorithm (generate / cache / resolve); each client supplies the
// STORAGE adapter (web: localStorage · mobile: Keychain/Keystore · Godot: a file) — so the credential's
// durability is the client's concern, the server only ever sees a normal username+password.
//
// NB: a localStorage/device credential is device-bound — clearing it loses the character. The portable upgrade
// (link a human-chosen password or an IdP to the same account) rides the same `password`/AuthMethod seam later.

/** A machine-generated, device-persisted credential. `username` is the stable uid; `password` is high-entropy. */
export interface SilentCredential {
  username: string;
  password: string;
}

/** Platform storage port for the silent credential. Synchronous (localStorage-shaped); a Keychain/file adapter
 *  can wrap its async API behind this or the SDK can grow an async variant when a client needs it. */
export interface CredentialStore {
  load(): SilentCredential | null;
  save(c: SilentCredential): void;
}

// Web Crypto — present in browsers and Node ≥ 19 (we target Node 24). Typed STRUCTURALLY (not the DOM `Crypto`
// lib type) so Jupiter's tsconfig stays DOM-free and portable to a GodotJS host. A host without a secure RNG must
// supply a polyfill; we fail loud rather than fall back to a weak RNG.
type RandomSource = { getRandomValues(array: Uint8Array): Uint8Array };
function randomBytes(n: number): Uint8Array {
  const c = (globalThis as { crypto?: RandomSource }).crypto;
  if (!c?.getRandomValues) throw new Error("jupiter: Web Crypto unavailable — a secure RNG is required for silent credentials");
  return c.getRandomValues(new Uint8Array(n));
}

/** URL-safe base64 of random bytes (browser + Node compatible; no Buffer). */
function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A fresh silent credential: a `guest-<hex>` uid + a 32-byte (256-bit) random password (well above the auth
 *  method's min length, so the floor never bites a generated credential). */
export function generateSilentCredential(): SilentCredential {
  const uid = `guest-${base64url(randomBytes(9))}`; // 12 url-safe chars
  const password = base64url(randomBytes(32));
  return { username: uid, password };
}

/** Load the cached credential, or generate + persist a fresh one on first run. */
export function resolveSilentCredentials(store: CredentialStore): SilentCredential {
  const existing = store.load();
  if (existing) return existing;
  const fresh = generateSilentCredential();
  store.save(fresh);
  return fresh;
}
