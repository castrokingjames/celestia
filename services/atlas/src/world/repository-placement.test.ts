// Acceptance tests for the Repository's placement ops against the REAL Postgres (run polaris migrate first
// — needs 0002). Sets up account + game_character rows directly, then exercises loadSpawn/savePlacement
// through the one Repository (Kysely adapter). it("when <condition>, then <outcome>").
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDb, KyselyRepository } from "@celestia/firmament";

const db = createDb();
const repo = new KyselyRepository(db);

async function freshCharacter(): Promise<{ id: string; name: string }> {
  const acc = await db.insertInto("account").values({ handle: null }).returning("id").executeTakeFirstOrThrow();
  const name = `T_${randomUUID().slice(0, 8)}`;
  const ch = await db
    .insertInto("game_character")
    .values({ account_id: acc.id, name })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { id: ch.id, name };
}

after(async () => {
  await db.destroy();
});

describe("Repository placement", () => {
  it("when a character has no placement yet, then loadSpawn returns the name with a null position", async () => {
    const c = await freshCharacter();
    const spawn = await repo.loadSpawn(c.id);
    assert.equal(spawn?.name, c.name);
    assert.equal(spawn?.x, null);
    assert.equal(spawn?.y, null);
  });

  it("when placement is saved, then loadSpawn returns the saved zone + position", async () => {
    const c = await freshCharacter();
    await repo.savePlacement(c.id, "genesis", 12.5, -4);
    const spawn = await repo.loadSpawn(c.id);
    assert.equal(spawn?.zoneId, "genesis");
    assert.equal(spawn?.x, 12.5);
    assert.equal(spawn?.y, -4);
  });

  it("when placement is saved twice, then it upserts (no duplicate) and reflects the latest", async () => {
    const c = await freshCharacter();
    await repo.savePlacement(c.id, "genesis", 1, 1);
    await repo.savePlacement(c.id, "genesis", 99, 99);
    const spawn = await repo.loadSpawn(c.id);
    assert.equal(spawn?.x, 99);
    assert.equal(spawn?.y, 99);
  });

  it("when the character does not exist, then loadSpawn returns null", async () => {
    assert.equal(await repo.loadSpawn(randomUUID()), null);
  });
});
