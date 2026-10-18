// Pure tests for the hash chain — no DB. Covers chaining, key-order-independence, and tamper detection.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nextRow, hashEvent, verifyChain, GENESIS_HASH } from "./event-chain.js";
import type { GameEvent } from "./types.js";

const actor = { accountId: "a1", characterId: "c1", role: "terra" };
const ev = (n: number): GameEvent => ({ type: "lever_toggled", at: 1000 + n, actor, data: { leverId: "lv1", on: n % 2 === 1 } });

function buildChain(count: number) {
  const rows = [];
  let head: { seq: number; hash: string } | null = null;
  for (let i = 1; i <= count; i++) {
    const row = nextRow(head, "genesis", ev(i));
    rows.push(row);
    head = { seq: row.seq, hash: row.hash };
  }
  return rows;
}

describe("event-chain", () => {
  it("nextRow produces a 1-based chain: GENESIS at seq 1, each prevHash === prior hash", () => {
    const rows = buildChain(3);
    assert.deepEqual(rows.map((r) => r.seq), [1, 2, 3]);
    assert.equal(rows[0].prevHash, GENESIS_HASH);
    assert.equal(rows[1].prevHash, rows[0].hash);
    assert.equal(rows[2].prevHash, rows[1].hash);
  });

  it("treats an undefined-valued key the same as an omitted key (matches the jsonb round-trip)", () => {
    const base = { stream: "z", seq: 1, type: "t", at: 5, actor: { accountId: "a", characterId: "c", role: "terra" } };
    const withUndef = { ...base, data: { x: 1, y: undefined } };
    const without = { ...base, data: { x: 1 } };
    assert.equal(hashEvent(GENESIS_HASH, withUndef), hashEvent(GENESIS_HASH, without));
  });

  it("hashEvent is deterministic and independent of key order in actor/data", () => {
    const base1 = { stream: "z", seq: 1, type: "t", at: 5, actor: { accountId: "a", characterId: "c", role: "terra" }, data: { x: 1, y: 2 } };
    const base2 = { stream: "z", seq: 1, type: "t", at: 5, actor: { role: "terra", characterId: "c", accountId: "a" }, data: { y: 2, x: 1 } };
    assert.equal(hashEvent(GENESIS_HASH, base1), hashEvent(GENESIS_HASH, base2));
  });

  it("verifyChain accepts a good chain", () => {
    assert.equal(verifyChain(buildChain(4)), true);
  });

  it("verifyChain rejects a mutated data field", () => {
    const rows = buildChain(3);
    rows[1] = { ...rows[1], data: { leverId: "lv1", on: !rows[1].data.on } };
    assert.equal(verifyChain(rows), false);
  });

  it("verifyChain rejects a forged hash", () => {
    const rows = buildChain(3);
    rows[2] = { ...rows[2], hash: "f".repeat(64) };
    assert.equal(verifyChain(rows), false);
  });

  it("verifyChain rejects a deleted middle event (seq gap)", () => {
    const rows = buildChain(3);
    rows.splice(1, 1); // drop seq 2 → [seq1, seq3]
    assert.equal(verifyChain(rows), false);
  });

  it("verifyChain rejects a reordered pair", () => {
    const rows = buildChain(3);
    [rows[0], rows[1]] = [rows[1], rows[0]];
    assert.equal(verifyChain(rows), false);
  });
});
