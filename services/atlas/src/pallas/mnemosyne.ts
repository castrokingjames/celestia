// pallas/mnemosyne.ts — MNEMOSYNE, the associative memory (NAMING §8; DECISIONS §2 tier-0/1). TCB-side (Pallas
// queries it and attaches the hits to the frame; the Gateway never touches pgvector — §2.1). In-memory stand-ins
// now so the whole seam runs with NO DB: a hash-embedder + a cosine top-k store. The pgvector adapter
// (CREATE EXTENSION vector + HNSW) implements the SAME MemoryStore port next, zero call-site change (G7).
import type { EmbeddingProvider, MemoryHit, MemoryStore } from "./types.js";

const EMBED_DIM = 16;

/** Deterministic hash-embedding — stable per text, no model. Cosine over these is meaningful enough to exercise
 *  recall ORDERING; a real embedding model replaces it behind the same port. */
export class HashEmbedder implements EmbeddingProvider {
  async embed(text: string): Promise<number[]> {
    const v = new Array<number>(EMBED_DIM).fill(0);
    for (let i = 0; i < text.length; i++) v[i % EMBED_DIM] += text.charCodeAt(i);
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => x / norm);
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** In-memory Mnemosyne (tests + pre-pgvector): recall = top-k by cosine similarity, tie-broken by salience. */
export class InMemoryMnemosyne implements MemoryStore {
  readonly #byActor = new Map<string, Array<MemoryHit & { embedding: number[] }>>();
  #seq = 0;

  async remember(
    actorId: string,
    rec: { text: string; salience: number; at: number; embedding: number[] },
  ): Promise<void> {
    const list = this.#byActor.get(actorId) ?? [];
    list.push({ id: `m${++this.#seq}`, ...rec });
    this.#byActor.set(actorId, list);
  }

  async recall(actorId: string, queryEmbedding: number[], k: number): Promise<MemoryHit[]> {
    const list = this.#byActor.get(actorId) ?? [];
    return list
      .map((m) => ({ m, sim: cosine(m.embedding, queryEmbedding) }))
      .sort((a, b) => b.sim - a.sim || b.m.salience - a.m.salience)
      .slice(0, k)
      .map(({ m }) => ({ id: m.id, text: m.text, salience: m.salience, at: m.at }));
  }
}
