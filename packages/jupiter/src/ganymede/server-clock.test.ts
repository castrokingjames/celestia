import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ServerClock } from "./server-clock.js";

describe("ServerClock", () => {
  it("when the first sample arrives, then it becomes ready and snaps to it", () => {
    const c = new ServerClock();
    assert.equal(c.ready, false);
    c.update(1000, 100); // offset = 900
    assert.equal(c.ready, true);
    assert.equal(c.now(100), 1000);
  });

  it("when the drift exceeds driftSnapMs, then it snaps to the new offset", () => {
    const c = new ServerClock(500, 0.05);
    c.update(1000, 100); // offset 900
    c.update(2000, 100); // drift 1000 > 500 → snap
    assert.equal(c.now(100), 2000);
  });

  it("when the drift is small (≤ driftSnapMs), then it EMA-smooths the offset", () => {
    const c = new ServerClock(500, 0.1);
    c.update(1000, 100); // offset 900
    c.update(1050, 100); // drift 50 ≤ 500 → offset = 900 + 50*0.1 = 905
    assert.equal(c.now(100), 1005);
  });

  it("when reset is called, then it clears readiness", () => {
    const c = new ServerClock();
    c.update(1000, 100);
    c.reset();
    assert.equal(c.ready, false);
  });
});
