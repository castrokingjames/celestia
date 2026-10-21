import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ZoneState, MobState, Player } from "../schema/ZoneState.js";
import { World, type MobAgent } from "./world.js";

const agent = (): MobAgent => ({
  kind: "rat",
  homeX: 0,
  homeY: 0,
  scatter: 96,
  roamX: 0,
  roamY: 0,
  targetId: null,
  lastDecisionAt: 0,
  attackReadyAt: 0,
  deadUntil: 0,
  corpseUntil: 0,
});

describe("World — mob entity lifecycle", () => {
  it("when a mob is spawned, then it registers on entities + synced state + the server-only agent store", () => {
    const w = new World(new ZoneState());
    const mob = new MobState();
    mob.id = "rat-0";
    mob.kind = "rat";
    mob.hp = 8;
    mob.maxHp = 8;
    w.spawnMob("rat-0", mob, agent());
    assert.ok(w.entities.has("rat-0"));
    assert.equal(w.state.mobs.get("rat-0")?.kind, "rat");
    assert.equal(w.mobAgents.get("rat-0")?.kind, "rat");
  });

  it("when a mob is despawned, then it is removed from every store", () => {
    const w = new World(new ZoneState());
    const mob = new MobState();
    mob.id = "rat-0";
    w.spawnMob("rat-0", mob, agent());
    w.despawn("rat-0");
    assert.equal(w.entities.has("rat-0"), false);
    assert.equal(w.state.mobs.has("rat-0"), false);
    assert.equal(w.mobAgents.has("rat-0"), false);
  });

  it("when a player is despawned, then its player/input stores clear and the mob store is untouched", () => {
    const w = new World(new ZoneState());
    const mob = new MobState();
    mob.id = "rat-0";
    w.spawnMob("rat-0", mob, agent());
    w.spawnPlayer("p1", new Player());
    w.despawn("p1");
    assert.equal(w.state.players.has("p1"), false);
    assert.equal(w.inputs.has("p1"), false);
    assert.ok(w.state.mobs.has("rat-0")); // the mob is unaffected
  });
});
