import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Predictor, applyCmd } from "./predictor.js";
import { MOVE_SPEED } from "@celestia/norma";

const STEP = MOVE_SPEED * 0.05; // one 0.05s command along an axis

describe("applyCmd", () => {
  it("when applyCmd integrates a command, then it moves at MOVE_SPEED and normalizes diagonals", () => {
    const p = { x: 0, y: 0 };
    applyCmd(p, { seq: 1, dx: 1, dy: 0, dt: 0.05 });
    assert.equal(p.x, STEP);
    const d = { x: 0, y: 0 };
    applyCmd(d, { seq: 1, dx: 1, dy: 1, dt: 0.05 });
    assert.equal(d.x, (1 / Math.hypot(1, 1)) * STEP);
  });
});

describe("collision mirror", () => {
  // A wall at x >= 100: canWalk blocks any target there — the same all-or-nothing step the server does.
  const canWalk = (x: number) => x < 100;

  it("when the target tile is not walkable, then applyCmd blocks the whole step", () => {
    const p = { x: 96, y: 0 }; // STEP = 8 → target 104 is blocked
    applyCmd(p, { seq: 1, dx: 1, dy: 0, dt: 0.05 }, canWalk);
    assert.deepEqual(p, { x: 96, y: 0 });
  });

  it("when the target tile stays walkable, then applyCmd allows the step", () => {
    const p = { x: 0, y: 0 };
    applyCmd(p, { seq: 1, dx: 1, dy: 0, dt: 0.05 }, canWalk);
    assert.equal(p.x, STEP);
  });

  it("when predicting and reconcile-replaying into a wall, then both respect the wall", () => {
    const pr = new Predictor();
    pr.setCanWalk(canWalk);
    pr.spawn(96, 0);
    pr.predict(1, 0, 0.05); // blocked → stays at the wall
    assert.equal(pr.x, 96);
    pr.reconcile(96, 0, 0); // replay the un-acked (blocked) command → still blocked
    assert.equal(pr.x, 96);
  });
});

describe("Predictor", () => {
  it("when predicting after spawn, then it moves immediately from the spawn position", () => {
    const pr = new Predictor();
    pr.spawn(10, 20);
    pr.predict(1, 0, 0.05);
    assert.equal(pr.x, 10 + STEP);
    assert.equal(pr.y, 20);
  });

  it("when reconciling a partial ack, then it snaps to the server pos and replays only the un-acked tail", () => {
    const pr = new Predictor();
    pr.spawn(0, 0);
    pr.predict(1, 0, 0.05); // seq 1
    pr.predict(1, 0, 0.05); // seq 2
    pr.predict(1, 0, 0.05); // seq 3 → predicted x = 3*STEP
    pr.reconcile(STEP, 0, 1); // server acked seq 1 at x=STEP; replay seq 2+3
    assert.equal(pr.x, 3 * STEP);
  });

  it("when reconciling with everything acked, then it lands exactly on the server pos", () => {
    const pr = new Predictor();
    pr.spawn(0, 0);
    pr.predict(1, 0, 0.05); // seq 1
    pr.reconcile(99, 7, 1); // all acked → no replay
    assert.deepEqual({ x: pr.x, y: pr.y }, { x: 99, y: 7 });
  });
});
