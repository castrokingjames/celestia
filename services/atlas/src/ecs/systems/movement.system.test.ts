// Unit tests for MovementSystem — pure (no DB, no Colyseus runtime): build a World over a bare ZoneState,
// queue inputs, run the system, assert the integrated transform. Pins the behavior lifted out of ZoneRoom.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MOVE_SPEED, INPUT_DT_MAX } from "@celestia/norma";
import type { ZoneMap } from "@celestia/firmament";
import { ZoneState, Player } from "../../schema/ZoneState.js";
import { World } from "../world.js";
import { MovementSystem } from "./movement.system.js";

const ctx = { dtMs: 1000 / 20, tMs: 0 }; // dtMs unused by movement (it integrates per-command dt); here for shape

function freshWorld() {
  const world = new World(new ZoneState());
  world.spawnPlayer("e1", new Player());
  return world;
}

describe("MovementSystem", () => {
  it("when an entity has a queued input, then it integrates at MOVE_SPEED and drains the queue", () => {
    const world = freshWorld();
    world.inputs.get("e1")!.push({ seq: 1, dx: 1, dy: 0, dt: 0.05 });
    new MovementSystem().update(world, ctx);
    const p = world.state.players.get("e1")!;
    assert.equal(p.x, MOVE_SPEED * 0.05); // 160 * 0.05 = 8
    assert.equal(p.y, 0);
    assert.equal(p.lastSeq, 1);
    assert.equal(world.inputs.get("e1")!.length, 0); // drained
  });

  it("when client dt exceeds the clamp, then only the clamped dt is integrated (G1 — client not trusted)", () => {
    const world = freshWorld();
    world.inputs.get("e1")!.push({ seq: 2, dx: 1, dy: 0, dt: 999 });
    new MovementSystem().update(world, ctx);
    assert.equal(world.state.players.get("e1")!.x, MOVE_SPEED * INPUT_DT_MAX);
  });

  it("when the direction is diagonal, then it is normalized (no diagonal speed boost)", () => {
    const world = freshWorld();
    world.inputs.get("e1")!.push({ seq: 3, dx: 1, dy: 1, dt: 0.05 });
    new MovementSystem().update(world, ctx);
    const p = world.state.players.get("e1")!;
    const expected = (1 / Math.hypot(1, 1)) * MOVE_SPEED * 0.05;
    assert.equal(p.x, expected);
    assert.equal(p.y, expected);
  });

  it("when there is no queued input, then the position is unchanged", () => {
    const world = freshWorld();
    new MovementSystem().update(world, ctx);
    const p = world.state.players.get("e1")!;
    assert.equal(p.x, 0);
    assert.equal(p.y, 0);
  });
});

// 4x3 grid, 32-unit tiles, a single box at tile (1,1) → world units x∈[32,64), y∈[32,64).
function mapWithBox(): ZoneMap {
  return {
    width: 4,
    height: 3,
    tileSize: 32,
    tiles: [
      [0, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 0, 0],
    ],
    spawns: { default: { x: 16, y: 16 } },
    portals: [],
  };
}

function worldAt(px: number, py: number): World {
  const world = new World(new ZoneState(), mapWithBox());
  const p = new Player();
  p.x = px;
  p.y = py;
  world.spawnPlayer("e1", p);
  return world;
}

describe("MovementSystem collision", () => {
  it("when a step's target tile is a box, then the step is rejected and the position is unchanged (no sliding yet)", () => {
    const world = worldAt(30, 40); // tile (0,1); +8 right lands on tile (1,1) = box
    world.inputs.get("e1")!.push({ seq: 1, dx: 1, dy: 0, dt: 0.05 });
    new MovementSystem().update(world, ctx);
    const p = world.state.players.get("e1")!;
    assert.equal(p.x, 30); // blocked — unchanged
    assert.equal(p.y, 40);
    assert.equal(p.lastSeq, 1); // the command was still processed/acked
  });

  it("when a step targets open floor, then the step is allowed and the entity moves", () => {
    const world = worldAt(30, 16); // tile (0,0); +8 right lands on tile (1,0) = floor
    world.inputs.get("e1")!.push({ seq: 1, dx: 1, dy: 0, dt: 0.05 });
    new MovementSystem().update(world, ctx);
    assert.equal(world.state.players.get("e1")!.x, 38);
  });
});
