import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RemoteInterpolator } from "./interpolator.js";

describe("RemoteInterpolator", () => {
  it("interpolates between the two bracketing snapshots", () => {
    const r = new RemoteInterpolator();
    r.push({ t: 0, x: 0, y: 0 });
    r.push({ t: 100, x: 100, y: 50 });
    assert.deepEqual(r.sample(50), { x: 50, y: 25 }); // midpoint
  });

  it("holds at the oldest snapshot before the buffer starts", () => {
    const r = new RemoteInterpolator();
    r.push({ t: 100, x: 10, y: 20 });
    r.push({ t: 200, x: 30, y: 40 });
    assert.deepEqual(r.sample(50), { x: 10, y: 20 }); // renderT < buf[0].t
  });

  it("extrapolates (capped) on underflow past the newest snapshot", () => {
    const r = new RemoteInterpolator(30, 150);
    r.push({ t: 0, x: 0, y: 0 });
    r.push({ t: 100, x: 100, y: 0 }); // velocity 1 unit/ms
    assert.equal(r.sample(180).x, 180); // 80ms ahead (≤150) → 100 + 80
    assert.equal(r.sample(400).x, 250); // 300ms ahead, capped to 150 → 100 + 150
  });

  it("holds at a single snapshot (no velocity to extrapolate)", () => {
    const r = new RemoteInterpolator();
    r.push({ t: 0, x: 5, y: 5 });
    assert.deepEqual(r.sample(999), { x: 5, y: 5 });
  });

  it("prune drops consumed snapshots, keeping one before renderT", () => {
    const r = new RemoteInterpolator();
    for (let t = 0; t <= 400; t += 100) r.push({ t, x: t, y: 0 });
    r.prune(250); // keep [200, 300, 400]
    assert.equal(r.sample(250).x, 250); // still interpolates 200..300
  });
});
