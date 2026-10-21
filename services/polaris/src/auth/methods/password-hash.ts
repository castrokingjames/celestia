// password-hash.ts — scrypt password hashing (node:crypto built-in, no native dep). The stored value is a
// SELF-DESCRIBING string so params can evolve without a migration: `scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>`.
// A server-side `pepper` (env, NEVER in the DB — G8) is mixed in, so a DB leak alone can't crack hashes.
// Verify is constant-time. Used by the `password` AuthMethod; a human-chosen password or a client-generated
// silent-account password hash identically.
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  pw: string | Buffer,
  salt: Buffer,
  keylen: number,
  opts: { N: number; r: number; p: number },
) => Promise<Buffer>;

// cost params: N=2^14 (~16 MB), r=8, p=1 — a sane interactive-login default; captured in the hash string so a
// future bump re-hashes lazily on next login without touching old rows.
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALT_BYTES = 16;

/** Hash a plaintext password with a fresh random salt + the server pepper. Returns the self-describing string. */
export async function hashPassword(plain: string, pepper: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(pepper + plain, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

/** Constant-time verify of a plaintext against a stored `scrypt$...` string. Any malformed input → false. */
export async function verifyPassword(plain: string, stored: string, pepper: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  if (salt.length === 0 || expected.length === 0) return false;
  const derived = await scrypt(pepper + plain, salt, expected.length, { N: n, r, p });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
