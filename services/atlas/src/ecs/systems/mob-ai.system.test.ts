// The decision is SEED-DRIVEN: these assert that the situation the system perceives, matched to the seeded
// precedents by Pallas, yields the right behaviour — flee when overmatched, attack when the target is wounded —
// plus the deterministic parts (no target → wander, dead → respawn). Flip the seed data and the behaviour flips;
// there is no action branch in the system to test.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ZoneState, MobState, Player } from "../../schema/ZoneState.js";
import { World, type MobAgent } from "../world.js";
import { MobAISystem } from "./mob-ai.system.js";
import { Pallas, HashEmbedder, InMemoryMnemosyne, InMemoryPrecedents } from "../../pallas/index.js";
import { MOB_TACTIC_SEED } from "../../content/mob-situations.js";
import type { MobKind } from "@celestia/firmament";
import type { TickContext } from "../types.js";

// A self-contained roster for the unit test (the real one is loaded from content/mobs.json via Caelum at boot).
const ROSTER: Record<string, MobKind> = {
  rat: { kind: "rat", sprite: "rat", level: 1, maxHp: 8, damage: 1, radius: 8, moveSpeed: 90, aggroRange: 160, attackRange: 40, attackCooldownMs: 1000, decisionIntervalMs: 500, respawnDelayMs: 5000 },
  skeleton: { kind: "skeleton", sprite: "skeleton", level: 8, maxHp: 30, damage: 4, radius: 11, moveSpeed: 110, aggroRange: 220, attackRange: 44, attackCooldownMs: 1200, decisionIntervalMs: 500, respawnDelayMs: 8000 },
};
const mobKind = (kind: string): MobKind | undefined => ROSTER[kind];

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0)); // let the off-tick decision resolve
const ctx = (tMs: number): TickContext => ({ dtMs: 50, tMs });

async function seededPallas(): Promise<Pallas> {
  const p = new Pallas(new HashEmbedder(), new InMemoryMnemosyne(), new InMemoryPrecedents(), null, "gates");
  await p.seed("mob.tactic", MOB_TACTIC_SEED);
  return p;
}

function mkMob(kind: string, x: number, y: number, home?: { x: number; y: number }): { mob: MobState; agent: MobAgent } {
  const k = mobKind(kind)!;
  const mob = new MobState();
  mob.id = `${kind}-0`;
  mob.kind = kind;
  mob.x = x;
  mob.y = y;
  mob.level = k.level;
  mob.hp = k.maxHp;
  mob.maxHp = k.maxHp;
  mob.action = "idle";
  const agent: MobAgent = {
    kind,
    homeX: home?.x ?? x,
    homeY: home?.y ?? y,
    scatter: 96,
    roamX: home?.x ?? x,
    roamY: home?.y ?? y,
    targetId: null,
    lastDecisionAt: 0,
    attackReadyAt: 0,
    deadUntil: 0,
    corpseUntil: 0,
  };
  return { mob, agent };
}

function mkPlayer(x: number, y: number, hp: number): Player {
  const p = new Player();
  p.x = x;
  p.y = y;
  p.hp = hp;
  p.maxHp = 20;
  return p;
}

describe("MobAISystem — Pallas (seeded precedents) drives the mob", () => {
  it("when a weak mob faces a strong, healthy player alone, then the seed says flee and the mob moves away", async () => {
    const pallas = await seededPallas();
    const attacks: Array<[string, string]> = [];
    const sys = new MobAISystem(pallas, mobKind, (m, t) => attacks.push([m, t]));
    const world = new World(new ZoneState()); // no map → unobstructed movement
    const { mob, agent } = mkMob("rat", 100, 100); // rat level 1 vs player level 5 → overmatched
    world.spawnMob(mob.id, mob, agent);
    world.spawnPlayer("p1", mkPlayer(120, 100, 20)); // full health, within aggro, to the east

    sys.update(world, ctx(50)); // perceive + dispatch the decision (fire-and-forget)
    await flush(); // decision resolves → mob.action set
    assert.equal(mob.action, "flee");
    const beforeX = mob.x;
    sys.update(world, ctx(100)); // act on flee → move away from the player (west)
    assert.ok(mob.x < beforeX, `expected flee west, x ${beforeX} -> ${mob.x}`);
    assert.equal(attacks.length, 0);
  });

  it("when a strong mob faces a wounded player in reach, then the seed says attack and it dispatches through Fornax", async () => {
    const pallas = await seededPallas();
    const attacks: Array<[string, string]> = [];
    const sys = new MobAISystem(pallas, mobKind, (m, t) => attacks.push([m, t]));
    const world = new World(new ZoneState());
    const { mob, agent } = mkMob("skeleton", 0, 0); // player is weaker than this mob
    world.spawnMob(mob.id, mob, agent);
    world.spawnPlayer("p1", mkPlayer(20, 0, 1)); // almost dead, within attack range

    sys.update(world, ctx(50));
    await flush();
    assert.equal(mob.action, "attack");
    sys.update(world, ctx(100)); // in range → dispatch the attack back through the combat pipeline
    assert.deepEqual(attacks, [[mob.id, "p1"]]);
  });

  it("when no player is in range and the mob is near its spawn, then the seed says wander", async () => {
    const pallas = await seededPallas();
    const sys = new MobAISystem(pallas, mobKind, () => assert.fail("must not attack"));
    const world = new World(new ZoneState());
    const { mob, agent } = mkMob("rat", 0, 0); // at its spawn → "near where I spawned"
    world.spawnMob(mob.id, mob, agent);
    world.spawnPlayer("p1", mkPlayer(1000, 1000, 20)); // far beyond the rat's aggro range → no enemy perceived

    sys.update(world, ctx(50));
    await flush(); // the "no enemy" case is a seeded decision now (not a branch) → resolves async
    assert.equal(mob.action, "wander");
    assert.equal(agent.targetId, null);
  });

  it("when no player is in range and the mob has strayed far from spawn, then the seed says return", async () => {
    const pallas = await seededPallas();
    const sys = new MobAISystem(pallas, mobKind, () => assert.fail("must not attack"));
    const world = new World(new ZoneState());
    const { mob, agent } = mkMob("rat", 1000, 1000, { x: 0, y: 0 }); // far (1414) from its home at (0,0)
    world.spawnMob(mob.id, mob, agent);
    // no players at all → no enemy perceived

    sys.update(world, ctx(50));
    await flush();
    assert.equal(mob.action, "return"); // seeded: no enemy + far from spawn → walk back
    const beforeX = mob.x;
    sys.update(world, ctx(100)); // act on return → move toward home (0,0), i.e. decreasing x
    assert.ok(mob.x < beforeX, `expected to head home, x ${beforeX} -> ${mob.x}`);
  });

  it("when a weak mob flees toward the map edge, then its body stops at the edge and never goes off-map", async () => {
    const pallas = await seededPallas();
    const sys = new MobAISystem(pallas, mobKind, () => {});
    const tiles = Array.from({ length: 10 }, () => new Array(10).fill(0)); // all floor; edges bound by isWalkable
    const map = { width: 10, height: 10, tileSize: 16, tiles, spawns: {}, portals: [] };
    const world = new World(new ZoneState(), map);
    const { mob, agent } = mkMob("rat", 20, 80); // near the west edge
    world.spawnMob(mob.id, mob, agent);
    world.spawnPlayer("p1", mkPlayer(120, 80, 20)); // healthy strong player to the east → the rat flees west

    sys.update(world, ctx(50));
    await flush();
    assert.equal(mob.action, "flee");
    for (let t = 100; t <= 2000; t += 50) sys.update(world, ctx(t)); // flee west into the edge for ~2s
    const r = mobKind("rat")!.radius;
    assert.ok(mob.x >= r - 1e-9, `body went off-map: x=${mob.x}, r=${r}`); // center ≥ r ⇒ left edge ≥ 0
    assert.ok(mob.x < 20, `expected it to flee west, x=${mob.x}`);
  });

  it("when a wall blocks the mob's path, then its body slides along it instead of lapping in or freezing", async () => {
    const pallas = await seededPallas();
    const sys = new MobAISystem(pallas, mobKind, () => {});
    // 10×10 @32px. A full horizontal wall at row 2 (y in [64,96)); everything else floor.
    const tiles = Array.from({ length: 10 }, () => new Array(10).fill(0));
    for (let tx = 0; tx < 10; tx++) tiles[2][tx] = 1;
    const map = { width: 10, height: 10, tileSize: 32, tiles, spawns: {}, portals: [] };
    const world = new World(new ZoneState(), map);
    // tile (1,1), home far to the south-east → the seed says "return", which paths into the wall then along it.
    const { mob, agent } = mkMob("rat", 48, 48, { x: 200, y: 300 });
    world.spawnMob(mob.id, mob, agent);
    // no players → "no enemy, strayed far" → return (seeded, async)

    sys.update(world, ctx(50));
    await flush(); // resolve the seeded decision
    assert.equal(mob.action, "return");
    for (let t = 100; t <= 2000; t += 50) sys.update(world, ctx(t)); // act on return → into the wall + slide east
    const r = mobKind("rat")!.radius;
    assert.ok(mob.y < 64 - r, `body lapped into the wall: y=${mob.y} (wall at 64, r=${r})`);
    assert.ok(mob.x > 60, `expected a horizontal slide east, x=${mob.x}`);
  });

  it("when an obstacle blocks the straight route home, then it paths AROUND it and reaches the spawn", async () => {
    const pallas = await seededPallas();
    const sys = new MobAISystem(pallas, mobKind, () => {});
    const tiles = Array.from({ length: 9 }, () => new Array(9).fill(0));
    tiles[4][3] = tiles[4][4] = tiles[4][5] = 1; // a wall segment straight between the mob and its home
    const map = { width: 9, height: 9, tileSize: 32, tiles, spawns: {}, portals: [] };
    const world = new World(new ZoneState(), map);
    const { mob, agent } = mkMob("rat", 144, 240, { x: 144, y: 48 }); // far below home → return (around the wall)
    world.spawnMob(mob.id, mob, agent);

    sys.update(world, ctx(50));
    await flush(); // seeded decision → "return" + A* route planned around the wall
    assert.equal(mob.action, "return");
    for (let t = 100; t <= 6000; t += 50) sys.update(world, ctx(t)); // follow the route
    const d = Math.hypot(mob.x - 144, mob.y - 48);
    assert.ok(d < 48, `expected to reach home around the wall, ended ${d.toFixed(0)}px away at (${mob.x.toFixed(0)},${mob.y.toFixed(0)})`);
  });

  it("when a mob dies, then a fresh UNIQUE mob spawns near its anchor and the corpse is flushed after (no reuse)", async () => {
    const pallas = await seededPallas();
    const spawned: Array<{ kind: string; x: number; y: number }> = [];
    const sys = new MobAISystem(pallas, mobKind, () => {}, (kind, x, y) => spawned.push({ kind, x, y }));
    const world = new World(new ZoneState());
    const { mob, agent } = mkMob("rat", 50, 50); // anchor (50,50); the mob died over at (10,10)
    mob.x = 10;
    mob.y = 10;
    mob.hp = 0; // killed → it's a corpse now
    mob.action = "dead";
    agent.deadUntil = 1000; // spawn the replacement at t=1000
    agent.corpseUntil = 1300; // flush this corpse at t=1300 (300ms later → overlap, no teleport)
    world.spawnMob(mob.id, mob, agent);

    sys.update(world, ctx(500)); // before deadUntil → no spawn, corpse stays
    assert.equal(spawned.length, 0);
    assert.ok(world.state.mobs.has(mob.id));

    sys.update(world, ctx(1000)); // deadUntil → a fresh mob spawns near the ANCHOR (room scatters around it)
    assert.deepEqual(spawned, [{ kind: "rat", x: 50, y: 50 }]);
    assert.ok(world.state.mobs.has(mob.id), "corpse still present during the overlap window");

    sys.update(world, ctx(1300)); // corpseUntil → the corpse entity is flushed (single-use, never revived)
    assert.equal(world.state.mobs.has(mob.id), false);
    assert.equal(spawned.length, 1); // spawned exactly once
  });
});
