// pallas/precedent.ts — the TIER-1 DECIDER: pure retrieval over the seeded vector store (DECISIONS §2). The
// decision is NOT computed here — it is READ from the nearest seeded precedent. Seed situation→action examples
// (data authored to start, grown by the model later), embed the live situation, pull the top-k nearest, and tally
// which action those neighbours took, weighted by similarity. No per-action coefficients, no formula: swap the
// seed data and the behaviour changes. SIM_FLOOR / k are retrieval knobs (how close counts, how many neighbours),
// not opinions about which action is good. A miss (nothing close enough) returns null → fall to the model/floor.
import type { GatewayProposal, PrecedentHit, PrecedentStore } from "./types.js";
import { cosine } from "./mnemosyne.js";

const SIM_FLOOR = 0.6; // top neighbour must be at least this similar, else it's a miss (→ model tier-2/3 / floor)

/** In-memory precedent store (tests + pre-pgvector): nearest-neighbour by cosine, keyed by decision schema. The
 *  pgvector adapter implements the SAME PrecedentStore port with HNSW ANN — zero call-site change (G7). */
export class InMemoryPrecedents implements PrecedentStore {
  readonly #bySchema = new Map<string, { embedding: number[]; action: string }[]>();

  async seed(schema: string, rows: { embedding: number[]; action: string }[]): Promise<void> {
    const list = this.#bySchema.get(schema) ?? [];
    list.push(...rows);
    this.#bySchema.set(schema, list);
  }

  async lookup(schema: string, queryEmbedding: number[], k: number): Promise<PrecedentHit[]> {
    const list = this.#bySchema.get(schema) ?? [];
    return list
      .map((p) => ({ action: p.action, score: cosine(p.embedding, queryEmbedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}

/** 1-NN retrieval → a proposal over the sim-authored option INDICES. The single NEAREST seeded precedent that
 *  maps to an allowed option IS the decision — read from the seed data, not computed, and immune to how many of
 *  each action were seeded. (Precedents whose action the sim didn't offer are skipped — sim-authored bounds, G2.)
 *  The shape matches what the model would return so the room's accept policy is identical. `p` / `abstainP` are
 *  the retrieval's CONFIDENCE (how similar the matched precedent is), NOT an opinion about which action is good.
 *  Returns null on a miss (nothing seeded close enough) → fall to the model (tier-2/3) or the scripted floor. */
export function decideByPrecedent(
  cid: string,
  hits: PrecedentHit[],
  allowedAnswers: string[],
): GatewayProposal | null {
  const nearest = hits.find((h) => h.score >= SIM_FLOOR && allowedAnswers.includes(h.action));
  if (!nearest) return null;
  const argmaxIndex = allowedAnswers.indexOf(nearest.action);
  return { cid, options: [{ index: argmaxIndex, p: nearest.score }], argmaxIndex, abstainP: 1 - nearest.score };
}
