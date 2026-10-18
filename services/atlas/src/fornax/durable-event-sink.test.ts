// Pure tests for DurableEventSink over an in-memory StubRowStore (implements the three Repository event
// methods). No Postgres — proves chaining, restart continuity, per-stream independence, and serialization.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DurableEventSink } from "./durable-event-sink.js";
import { verifyChain } from "./event-chain.js";
import type { GameEvent } from "./types.js";
import type { EventRow } from "@celestia/firmament";

// Mimics the Postgres PK(stream,seq) + unique(hash) backstops so races/double-appends fail loud like the DB.
class StubRowStore {
  readonly rows: EventRow[] = [];
  async appendEvent(row: EventRow): Promise<void> {
    if (this.rows.some((r) => r.stream === row.stream && r.seq === row.seq)) throw new Error("duplicate (stream,seq)");
    if (this.rows.some((r) => r.hash === row.hash)) throw new Error("duplicate hash");
    this.rows.push(row);
  }
  async getEventChainHead(stream: string): Promise<{ seq: number; hash: string } | null> {
    const forStream = this.rows.filter((r) => r.stream === stream);
    if (forStream.length === 0) return null;
    const head = forStream.reduce((a, b) => (b.seq > a.seq ? b : a));
    return { seq: head.seq, hash: head.hash };
  }
  async readEventStream(stream: string): Promise<EventRow[]> {
    return this.rows.filter((r) => r.stream === stream).sort((a, b) => a.seq - b.seq);
  }
}

const actor = { accountId: "a1", characterId: "c1", role: "terra" };
const ev = (n: number): GameEvent => ({ type: "lever_toggled", at: 1000 + n, actor, data: { leverId: "lv1", on: n % 2 === 1 } });

describe("DurableEventSink", () => {
  it("appends a verifiable chain to the store", async () => {
    const store = new StubRowStore();
    const sink = new DurableEventSink(store, "genesis");
    await sink.append(ev(1));
    await sink.append(ev(2));
    await sink.append(ev(3));
    const rows = await store.readEventStream("genesis");
    assert.deepEqual(rows.map((r) => r.seq), [1, 2, 3]);
    assert.equal(verifyChain(rows), true);
  });

  it("a fresh sink over the same store RESUMES the chain (restart continuity)", async () => {
    const store = new StubRowStore();
    await new DurableEventSink(store, "genesis").append(ev(1));
    // new sink instance (simulated restart) — must read the head and continue, not restart at seq 1
    const sink2 = new DurableEventSink(store, "genesis");
    await sink2.append(ev(2));
    const rows = await store.readEventStream("genesis");
    assert.deepEqual(rows.map((r) => r.seq), [1, 2]);
    assert.equal(rows[1].prevHash, rows[0].hash);
    assert.equal(verifyChain(rows), true);
  });

  it("keeps per-stream chains independent", async () => {
    const store = new StubRowStore();
    const g = new DurableEventSink(store, "genesis");
    const v = new DurableEventSink(store, "verdant");
    await g.append(ev(1));
    await v.append(ev(1));
    await g.append(ev(2));
    assert.deepEqual((await store.readEventStream("genesis")).map((r) => r.seq), [1, 2]);
    assert.deepEqual((await store.readEventStream("verdant")).map((r) => r.seq), [1]);
    assert.equal(verifyChain(await store.readEventStream("genesis")), true);
    assert.equal(verifyChain(await store.readEventStream("verdant")), true);
  });

  it("serializes interleaved appends into a contiguous chain", async () => {
    const store = new StubRowStore();
    const sink = new DurableEventSink(store, "genesis");
    // fire all at once without awaiting each — the internal queue must still order them
    await Promise.all([sink.append(ev(1)), sink.append(ev(2)), sink.append(ev(3)), sink.append(ev(4))]);
    const rows = await store.readEventStream("genesis");
    assert.deepEqual(rows.map((r) => r.seq), [1, 2, 3, 4]);
    assert.equal(verifyChain(rows), true);
  });

  it("survives a transient append failure: the queue is not poisoned and the chain stays gapless", async () => {
    const store = new StubRowStore();
    let failNext = false;
    const flaky = {
      async appendEvent(row: EventRow) {
        if (failNext) {
          failNext = false;
          throw new Error("transient db error");
        }
        return store.appendEvent(row);
      },
      getEventChainHead: (s: string) => store.getEventChainHead(s),
    };
    const sink = new DurableEventSink(flaky, "genesis");
    await sink.append(ev(1)); // seq 1 persists
    failNext = true;
    await assert.rejects(() => sink.append(ev(2))); // this append fails (no row written)
    await sink.append(ev(3)); // queue NOT poisoned → runs; head reloads → reuses seq 2, no gap
    const rows = await store.readEventStream("genesis");
    assert.deepEqual(rows.map((r) => r.seq), [1, 2]);
    assert.equal(verifyChain(rows), true);
  });
});
