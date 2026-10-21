import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RemoteInterpolator } from "./interpolator.js";

describe("RemoteInterpolator", () => {
  it("when sampling between two bracketing snapshots, then interpolates to the midpoint", () => {
    const r = new RemoteInterpolator();
    r.push({ t: 0, x: 0, y: 0 });
    r.push({ t: 100, x: 60, y: 30 }); // sub-teleport delta (≈67 < 96) → normal interpolation
    assert.deepEqual(r.sample(50), { x: 30, y: 15 }); // midpoint
  });

  it("when renderT is before the buffer starts, then holds at the oldest snapshot", () => {
    const r = new RemoteInterpolator();
    r.push({ t: 100, x: 10, y: 20 });
    r.push({ t: 200, x: 30, y: 40 });
    assert.deepEqual(r.sample(50), { x: 10, y: 20 }); // renderT < buf[0].t
  });

  it("when sampling past the newest snapshot, then extrapolates capped to the limit", () => {
    const r = new RemoteInterpolator(30, 150);
    r.push({ t: 0, x: 0, y: 0 });
    r.push({ t: 100, x: 60, y: 0 }); // velocity 0.6 unit/ms (sub-teleport delta)
    assert.equal(r.sample(180).x, 108); // 80ms ahead (≤150) → 60 + 0.6·80
    assert.equal(r.sample(400).x, 150); // 300ms ahead, capped to 150 → 60 + 0.6·150
  });

  it("when only a single snapshot exists, then holds its position (no velocity to extrapolate)", () => {
    const r = new RemoteInterpolator();
    r.push({ t: 0, x: 5, y: 5 });
    assert.deepEqual(r.sample(999), { x: 5, y: 5 });
  });

  it("when a snapshot jumps a teleport-sized distance (respawn/portal), then it snaps instead of gliding across", () => {
    const r = new RemoteInterpolator();
    r.push({ t: 0, x: 0, y: 0 });
    r.push({ t: 50, x: 5, y: 0 }); // normal motion — buffered, still interpolates
    r.push({ t: 100, x: 900, y: 600 }); // > TELEPORT_DIST from the last → discontinuity, buffer resets
    // renderT between the old and new would have glided to mid-map; instead the buffer holds only the new spot.
    assert.deepEqual(r.sample(60), { x: 900, y: 600 });
    assert.deepEqual(r.sample(100), { x: 900, y: 600 });
  });

  it("when prune runs, then it drops consumed snapshots but keeps one before renderT", () => {
    const r = new RemoteInterpolator();
    for (let t = 0; t <= 400; t += 100) r.push({ t, x: t * 0.5, y: 0 }); // sub-teleport deltas (50)
    r.prune(250); // keep [200, 300, 400] → x 100,150,200
    assert.equal(r.sample(250).x, 125); // still interpolates 200(100)..300(150)
  });
});
