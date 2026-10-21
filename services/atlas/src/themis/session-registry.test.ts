// Pure tests for SessionRegistry — fake Kickable clients (a leave() spy), no Colyseus server.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SessionRegistry } from "./session-registry.js";

function fakeClient(sessionId: string) {
  const left: number[] = [];
  return { sessionId, leave: (code?: number) => left.push(code ?? 0), left };
}

describe("SessionRegistry", () => {
  it("when a new connection registers for an account, then it displaces the old with 4409 (one session per account)", () => {
    const reg = new SessionRegistry();
    const c1 = fakeClient("s1");
    const c2 = fakeClient("s2");
    reg.register("acc", c1);
    reg.register("acc", c2);
    assert.deepEqual(c1.left, [4409]);
    assert.deepEqual(c2.left, []);
    assert.deepEqual(reg.accountIds(), ["acc"]);
  });

  it("when the same connection re-registers, then it is idempotent (no displace)", () => {
    const reg = new SessionRegistry();
    const c1 = fakeClient("s1");
    reg.register("acc", c1);
    reg.register("acc", c1);
    assert.deepEqual(c1.left, []);
  });

  it("when kick targets a connected account, then it evicts the live connection with 4403 and clears the slot", () => {
    const reg = new SessionRegistry();
    const c1 = fakeClient("s1");
    reg.register("acc", c1);
    reg.kick("acc", 4403);
    assert.deepEqual(c1.left, [4403]);
    assert.deepEqual(reg.accountIds(), []);
  });

  it("when kick targets an account not connected here, then it is a no-op", () => {
    const reg = new SessionRegistry();
    reg.kick("ghost", 4403); // must not throw
    assert.deepEqual(reg.accountIds(), []);
  });

  it("when remove is called, then it only drops on identity match (a displaced client's late leave is ignored)", () => {
    const reg = new SessionRegistry();
    const c1 = fakeClient("s1");
    const c2 = fakeClient("s2");
    reg.register("acc", c1);
    reg.register("acc", c2); // c1 displaced; c2 is now registered
    reg.remove("acc", c1); // stale — must NOT remove c2
    assert.deepEqual(reg.accountIds(), ["acc"]);
    reg.remove("acc", c2); // the real one
    assert.deepEqual(reg.accountIds(), []);
  });
});
