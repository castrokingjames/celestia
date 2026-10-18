// fornax/event-chain.ts — the pure hash-chain core for the durable event log (G4). No I/O, no Colyseus, no
// wall-clock — just node:crypto over data, so it is fully unit-testable and deterministic across processes +
// replay. Each stream (= zone id) is an independent chain: hash = sha256(prev_hash || canonical(payload)),
// seq per-stream 1-based + gapless, genesis a fixed constant. `verifyChain` is the replay/audit verifier —
// replay reads logged outputs and re-derives nothing but the hash to detect tamper/reorder/gaps.
import { createHash } from "node:crypto";
import type { GameEvent } from "./types.js";
import type { EventRow } from "@celestia/firmament";

/** The seq-0 anchor every stream's first prev_hash points at. */
export const GENESIS_HASH = createHash("sha256").update("celestia:log:genesis").digest("hex");

/** The hashed part of a row (surrogate/storage fields like recorded_at are deliberately EXCLUDED). */
type HashBase = {
  stream: string;
  seq: number;
  type: string;
  at: number;
  actor: Record<string, unknown>;
  data: Record<string, unknown>;
};

/** Deterministic, key-sorted, whitespace-free JSON — the hash input must not depend on key order. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  // OMIT undefined-valued keys — jsonb storage (node-postgres' JSON.stringify) drops them, so hashing them as
  // `null` would make verifyChain reject the untouched round-tripped row. Match the stored shape exactly.
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function canonical(base: HashBase): string {
  return stableStringify(base);
}

/** sha256(prevHash || canonical(base)) as hex. */
export function hashEvent(prevHash: string, base: HashBase): string {
  return createHash("sha256").update(prevHash).update(canonical(base)).digest("hex");
}

/** Build the next row in a stream's chain from its current head (null at genesis) + a game event. */
export function nextRow(head: { seq: number; hash: string } | null, stream: string, event: GameEvent): EventRow {
  const seq = (head?.seq ?? 0) + 1;
  const prevHash = head?.hash ?? GENESIS_HASH;
  const actor: Record<string, unknown> = {
    accountId: event.actor.accountId,
    characterId: event.actor.characterId,
    role: event.actor.role,
  };
  const base: HashBase = { stream, seq, type: event.type, at: event.at, actor, data: event.data };
  return { stream, seq, prevHash, hash: hashEvent(prevHash, base), type: event.type, at: event.at, actor, data: event.data };
}

/** Verify a full stream (ordered from seq 1): contiguous seqs, prev_hash links, and each hash recomputes.
 *  Returns false on ANY tamper, reorder, gap, or forged hash. */
export function verifyChain(rows: EventRow[]): boolean {
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.seq !== i + 1) return false;
    if (row.prevHash !== prevHash) return false;
    const base: HashBase = { stream: row.stream, seq: row.seq, type: row.type, at: row.at, actor: row.actor, data: row.data };
    if (row.hash !== hashEvent(prevHash, base)) return false;
    prevHash = row.hash;
  }
  return true;
}
