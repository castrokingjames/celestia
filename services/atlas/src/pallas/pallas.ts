// pallas/pallas.ts — PALLAS, the TCB-side decision orchestrator (the thin coordinator, like Fornax for actions).
// It runs ENTIRELY inside the trusted room and walks the DECISIONS.md cascade:
//   tier-1  decideFromPrecedent — retrieve the nearest SEEDED precedent for the situation and vote. Fast, local,
//           on-tick. The choice is READ from the seed data, not computed. This handles "basic stuff" with NO model.
//   tier-2/3 dispatch — only on a tier-1 MISS, hand the frame to the model Gateway (Mercury/Calliope) OFF-tick
//           (never awaits — inference can't block the 20 Hz tick, COGNITION §2.4); drain the proposal later. The
//           gateway is NULL until a model is wired, so a miss simply falls through to the scripted floor.
// Either way the proposal (a distribution over sim-authored option INDICES) goes through the room's ACCEPT policy;
// the consumer maps the chosen index to a Fornax action, RE-VALIDATES (G2), executes, and writes memory.
// Mnemosyne (per-player episodic memory) is separate from the precedent store (shared tier-1 knowledge).
import type {
  AcceptMode,
  Accepted,
  CognitionGateway,
  DecisionFrame,
  EmbeddingProvider,
  GatewayProposal,
  MemoryHit,
  MemoryStore,
  Precedent,
  PrecedentStore,
} from "./types.js";
import { accept } from "./accept.js";
import { decideByPrecedent } from "./precedent.js";

export type PendingProposal = { cid: string; frame: DecisionFrame; proposal: GatewayProposal };

export class Pallas {
  #inflight = 0;
  readonly #done: PendingProposal[] = [];

  constructor(
    private readonly embedder: EmbeddingProvider,
    private readonly memory: MemoryStore,
    private readonly precedents: PrecedentStore,
    private readonly gateway: CognitionGateway | null = null, // tier-2/3 model slot; null until Mercury/Calliope
    private readonly mode: AcceptMode = "gates",
    private readonly maxConcurrent = 8,
  ) {}

  // ---- Mnemosyne: per-player episodic memory, TCB-side (never the Gateway, §2.1) ----

  /** Recall scoped memory TCB-side (embed the query, pull top-k) — attached to the frame. */
  async recall(actorId: string, query: string, k = 4): Promise<MemoryHit[]> {
    return this.memory.recall(actorId, await this.embedder.embed(query), k);
  }

  /** Write a memory TCB-side (embed + store). */
  async remember(actorId: string, rec: { text: string; salience: number; at: number }): Promise<void> {
    await this.memory.remember(actorId, { ...rec, embedding: await this.embedder.embed(rec.text) });
  }

  // ---- Precedent store: shared tier-1 knowledge, seeded (then grown by the model) ----

  /** Seed the shared precedent store for a decision schema (embeds each situation TCB-side). */
  async seed(schema: string, precedents: Precedent[]): Promise<void> {
    const rows = await Promise.all(
      precedents.map(async (p) => ({ embedding: await this.embedder.embed(p.situation), action: p.action })),
    );
    await this.precedents.seed(schema, rows);
  }

  /** TIER-1 decide: embed the situation, retrieve the nearest seeded precedents, vote → a proposal (or null on a
   *  miss → the caller dispatches to the model or drops to the floor). Fast + local; runs on-tick. */
  async decideFromPrecedent(frame: DecisionFrame, k = 5): Promise<GatewayProposal | null> {
    const hits = await this.precedents.lookup(frame.schema, await this.embedder.embed(frame.question), k);
    return decideByPrecedent(frame.cid, hits, frame.allowedAnswers);
  }

  // ---- Model gateway: tier-2/3, OFF-tick (null until a model is wired) ----

  /** Dispatch a decision OFF-tick (never awaits). Returns the frame's cid, or null if no model is configured or at
   *  capacity → the caller falls back to the scripted floor (backpressure, §5 per-zone budget). */
  dispatch(frame: DecisionFrame): string | null {
    if (!this.gateway || this.#inflight >= this.maxConcurrent) return null;
    this.#inflight++;
    this.gateway
      .decide(frame)
      .then((proposal) => this.#done.push({ cid: frame.cid, frame, proposal }))
      .catch(() =>
        this.#done.push({ cid: frame.cid, frame, proposal: { cid: frame.cid, options: [], argmaxIndex: -1, abstainP: 1 } }),
      )
      .finally(() => {
        this.#inflight--;
      });
    return frame.cid;
  }

  /** Collect proposals resolved since the last drain (call on a later tick). */
  drain(): PendingProposal[] {
    return this.#done.length ? this.#done.splice(0, this.#done.length) : [];
  }

  /** Apply the room's accept policy (gates|rankings) → a chosen option index, or an abstain (→ floor). */
  accept(proposal: GatewayProposal): Accepted {
    return accept(proposal, this.mode);
  }

  get inflight(): number {
    return this.#inflight;
  }
}
