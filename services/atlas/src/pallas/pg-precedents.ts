// pallas/pg-precedents.ts — the pgvector-backed PrecedentStore (DECISIONS §2 tier-1): the REAL backing that
// InMemoryPrecedents stood in for. A PURE adapter — it holds no SQL; the vector INSERT + nearest-neighbour SELECT
// live behind the Repository port (firmament's one ORM boundary, G7). Embeddings arrive ALREADY computed (Pallas
// embeds before calling the store), so this only forwards number[] vectors to the port. Drop-in: swapping
// `new InMemoryPrecedents()` → `new PgPrecedents(repo)` changes nothing else (same PrecedentStore port).
import type { PrecedentMatch, Repository } from "@celestia/firmament";
import type { PrecedentHit, PrecedentStore } from "./types.js";

type PrecedentRepo = Pick<Repository, "seedPrecedents" | "nearestPrecedents">;

export class PgPrecedents implements PrecedentStore {
  constructor(private readonly repo: PrecedentRepo) {}

  async seed(schema: string, rows: { embedding: number[]; action: string }[]): Promise<void> {
    await this.repo.seedPrecedents(schema, rows);
  }

  async lookup(schema: string, queryEmbedding: number[], k: number): Promise<PrecedentHit[]> {
    const matches: PrecedentMatch[] = await this.repo.nearestPrecedents(schema, queryEmbedding, k);
    return matches.map((m) => ({ action: m.action, score: m.score }));
  }
}
