import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CognitionGateway, DecisionFrame, GatewayProposal, Precedent } from "./types.js";
import { accept } from "./accept.js";
import { Pallas } from "./pallas.js";
import { HashEmbedder, InMemoryMnemosyne } from "./mnemosyne.js";
import { InMemoryPrecedents } from "./precedent.js";

// The DECISION comes from SEEDED DATA retrieved by similarity (DECISIONS §2 tier-1), not from hand-written weights
// or a live model. So the tests assert: (a) the room-side accept policy, (b) that retrieval returns whichever
// action the nearest seeded precedent recorded — flip the seed and the behaviour flips — and (c) the off-tick
// mailbox mechanism that the model (tier-2/3) plugs into later. There is intentionally NO decision formula to test.

const prop = (options: { index: number; p: number }[], argmaxIndex: number, abstainP = 0): GatewayProposal => ({
  cid: "c",
  options,
  argmaxIndex,
  abstainP,
});

describe("accept policy (room-side; the gates↔rankings calibration config flip)", () => {
  it("when gates mode and the argmax is confident, then it accepts that index", () => {
    assert.equal(accept(prop([{ index: 0, p: 0.9 }, { index: 1, p: 0.1 }], 0), "gates").chosenIndex, 0);
  });
  it("when the distribution is flat, then gates abstains but rankings still picks the top-ranked", () => {
    const flat = prop([{ index: 0, p: 0.34 }, { index: 1, p: 0.33 }, { index: 2, p: 0.33 }], 0);
    assert.equal(accept(flat, "gates").abstained, true);
    assert.equal(accept(flat, "rankings").chosenIndex, 0);
  });
  it("when abstainP is high, then it abstains in either mode", () => {
    const p = prop([{ index: 0, p: 0.9 }, { index: 1, p: 0.1 }], 0, 0.8);
    assert.equal(accept(p, "gates").abstained, true);
    assert.equal(accept(p, "rankings").abstained, true);
  });
  it("when the option set is empty, then it abstains", () => {
    assert.equal(accept(prop([], -1, 1), "gates").abstained, true);
  });
});

// A generic seed set — this tests the Pallas MECHANISM (seed → retrieve nearest → action), not any game content.
const ACTIONS = ["flee", "attack", "wander"];
const SEED: Precedent[] = [
  { situation: "a towering armored knight bears down on me", action: "flee" },
  { situation: "a wounded rat lies nearly dead before me", action: "attack" },
  { situation: "the meadow is calm and nothing stirs", action: "wander" },
];
function mkFrame(question: string, cid = "c"): DecisionFrame {
  return { cid, schema: "demo", question, context: {}, allowedAnswers: ACTIONS, memories: [], at: 0, deadlineMs: 50 };
}
async function seeded(mode: "gates" | "rankings" = "gates"): Promise<Pallas> {
  const p = new Pallas(new HashEmbedder(), new InMemoryMnemosyne(), new InMemoryPrecedents(), null, mode);
  await p.seed("demo", SEED);
  return p;
}

describe("tier-1 retrieval — the decision IS the nearest seeded precedent", () => {
  it("when the situation matches the flee precedent, then it retrieves flee", async () => {
    const pallas = await seeded();
    const proposal = await pallas.decideFromPrecedent(mkFrame("a towering armored knight bears down on me"));
    assert.ok(proposal);
    assert.equal(ACTIONS[pallas.accept(proposal).chosenIndex!], "flee");
  });

  it("when the situation matches the attack precedent, then it retrieves attack", async () => {
    const pallas = await seeded();
    const proposal = await pallas.decideFromPrecedent(mkFrame("a wounded rat lies nearly dead before me"));
    assert.ok(proposal);
    assert.equal(ACTIONS[pallas.accept(proposal).chosenIndex!], "attack");
  });

  it("when the situation matches the wander precedent, then it retrieves wander", async () => {
    const pallas = await seeded();
    const proposal = await pallas.decideFromPrecedent(mkFrame("the meadow is calm and nothing stirs"));
    assert.ok(proposal);
    assert.equal(ACTIONS[pallas.accept(proposal).chosenIndex!], "wander");
  });

  it("when the schema was never seeded, then it returns null so the caller drops to the model or floor", async () => {
    const pallas = await seeded();
    const frame = { ...mkFrame("anything"), schema: "mob.unseeded" };
    assert.equal(await pallas.decideFromPrecedent(frame), null);
  });

  it("when the nearest precedent's action is not an allowed answer, then it never proposes it (sim-authored bounds)", async () => {
    const pallas = await seeded();
    const frame = {
      ...mkFrame("a towering armored knight bears down on me"), // nearest precedent is "flee"
      allowedAnswers: ["attack", "wander"], // "flee" withheld this tick
    };
    const proposal = await pallas.decideFromPrecedent(frame);
    if (proposal) assert.ok(["attack", "wander"].includes(frame.allowedAnswers[proposal.argmaxIndex]));
  });
});

// A gateway whose promises resolve only when flushed — asserts the off-tick (never-blocks) model path (tier-2/3)
// WITHOUT a real model. This slot is NULL in production until Mercury/Calliope is wired; the value is fixed, not a
// decision policy.
class ManualGateway implements CognitionGateway {
  readonly #pending: Array<() => void> = [];
  decide(f: DecisionFrame): Promise<GatewayProposal> {
    return new Promise((resolve) =>
      this.#pending.push(() => resolve({ cid: f.cid, options: [{ index: 0, p: 1 }], argmaxIndex: 0, abstainP: 0 })),
    );
  }
  flush(): void {
    this.#pending.splice(0).forEach((r) => r());
  }
}
const nextTick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("Pallas — off-tick model path (tier-2/3): dispatch/drain + backpressure + null-when-unwired", () => {
  it("when no gateway is configured, then dispatch returns null (basic stuff is tier-1 only; model fills gaps later)", () => {
    const pallas = new Pallas(new HashEmbedder(), new InMemoryMnemosyne(), new InMemoryPrecedents(), null);
    assert.equal(pallas.dispatch(mkFrame("q")), null);
  });

  it("when a decision is dispatched, then it never blocks and drain yields the proposal only after it resolves on a later tick", async () => {
    const g = new ManualGateway();
    const pallas = new Pallas(new HashEmbedder(), new InMemoryMnemosyne(), new InMemoryPrecedents(), g, "rankings");
    const cid = pallas.dispatch(mkFrame("q", "c1"));
    assert.ok(cid);
    assert.equal(pallas.drain().length, 0); // not resolved yet — the tick moved on
    g.flush();
    await nextTick();
    const done = pallas.drain();
    assert.equal(done.length, 1);
    assert.equal(done[0].cid, cid);
  });

  it("when at the concurrency cap, then dispatch is refused so the caller falls to the scripted floor", async () => {
    const g = new ManualGateway();
    const pallas = new Pallas(new HashEmbedder(), new InMemoryMnemosyne(), new InMemoryPrecedents(), g, "rankings", 1);
    assert.ok(pallas.dispatch(mkFrame("q", "a")));
    assert.equal(pallas.inflight, 1);
    assert.equal(pallas.dispatch(mkFrame("q", "b")), null); // at capacity
    g.flush();
    await nextTick();
    assert.equal(pallas.inflight, 0);
  });

  it("when an actor recalls, then it surfaces its own memory and another actor sees nothing (no cross-leak)", async () => {
    const pallas = new Pallas(new HashEmbedder(), new InMemoryMnemosyne(), new InMemoryPrecedents(), null);
    await pallas.remember("rat1", { text: "a strong knight hit me hard", salience: 1, at: 0 });
    const mine = await pallas.recall("rat1", "strong knight", 4);
    assert.ok(mine.some((h) => h.text.includes("knight")));
    assert.equal((await pallas.recall("rat2", "strong knight", 4)).length, 0); // another actor sees nothing
  });
});
