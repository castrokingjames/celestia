// PgPrecedents is a pure forwarder onto the Repository port (the SQL lives in firmament). So the only thing to
// test here is that the PrecedentStore port maps onto the repo methods — no DB. The real pgvector query is
// exercised against a live Postgres, not in unit tests (there's no test DB in the repo).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PrecedentMatch } from "@celestia/firmament";
import { PgPrecedents } from "./pg-precedents.js";

class FakeRepo {
  seeded: { schemaKey: string; rows: { embedding: number[]; action: string }[] } | null = null;
  matches: PrecedentMatch[] = [];
  async seedPrecedents(schemaKey: string, rows: readonly { embedding: number[]; action: string }[]): Promise<void> {
    this.seeded = { schemaKey, rows: [...rows] };
  }
  async nearestPrecedents(_schemaKey: string, _embedding: number[], _k: number): Promise<PrecedentMatch[]> {
    return this.matches;
  }
}

describe("PgPrecedents — forwards the PrecedentStore port to the Repository (no SQL here)", () => {
  it("when seeding, then it forwards the schema + rows to the repository verbatim", async () => {
    const repo = new FakeRepo();
    await new PgPrecedents(repo).seed("mob.tactic", [{ embedding: [1, 0], action: "flee" }]);
    assert.equal(repo.seeded?.schemaKey, "mob.tactic");
    assert.deepEqual(repo.seeded?.rows, [{ embedding: [1, 0], action: "flee" }]);
  });

  it("when looking up, then it returns the repo's matches as precedent hits (action + score)", async () => {
    const repo = new FakeRepo();
    repo.matches = [
      { action: "attack", score: 0.9 },
      { action: "flee", score: 0.4 },
    ];
    const hits = await new PgPrecedents(repo).lookup("mob.tactic", [0, 1], 2);
    assert.deepEqual(hits, [
      { action: "attack", score: 0.9 },
      { action: "flee", score: 0.4 },
    ]);
  });
});
