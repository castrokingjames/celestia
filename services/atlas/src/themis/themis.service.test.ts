// Pure tests for the revocation SWEEP orchestration (the enforcement loop) — stub repo + a real SessionRegistry
// with fake clients. No DB, no interval (we call sweep() directly). ConfigService is only used by the interval
// setup, not by sweep(), so a minimal stub suffices.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ThemisService } from "./themis.service.js";
import { SessionRegistry } from "./session-registry.js";
import type { ConfigService } from "@celestia/firmament/nest";

function fakeClient(sessionId: string) {
  const left: number[] = [];
  return { sessionId, leave: (code?: number) => left.push(code ?? 0), left };
}
const cfg = { revocationSweepSec: 10 } as unknown as ConfigService;

describe("ThemisService.sweep", () => {
  it("kicks present accounts that are no longer active, leaves active ones", async () => {
    const registry = new SessionRegistry();
    const a = fakeClient("sA");
    const b = fakeClient("sB");
    const c = fakeClient("sC");
    registry.register("A", a);
    registry.register("B", b);
    registry.register("C", c);
    const statuses = new Map([
      ["A", "active"],
      ["B", "banned"],
      ["C", "suspended"],
    ]);
    const repo = {
      async getAccountStatuses(ids: readonly string[]) {
        return new Map([...statuses].filter(([id]) => ids.includes(id)));
      },
    };
    const themis = new ThemisService(repo, registry, cfg);
    await themis.sweep();
    assert.deepEqual(a.left, []); // active stays
    assert.deepEqual(b.left, [4403]); // banned evicted
    assert.deepEqual(c.left, [4403]); // suspended evicted
    assert.deepEqual(registry.accountIds(), ["A"]);
  });

  it("no-ops (no DB read) when no accounts are present", async () => {
    const registry = new SessionRegistry();
    let read = false;
    const repo = {
      async getAccountStatuses() {
        read = true;
        return new Map<string, string>();
      },
    };
    await new ThemisService(repo, registry, cfg).sweep();
    assert.equal(read, false); // early return on empty registry
  });

  it("fail-closed: an account whose status is missing from the read is evicted", async () => {
    const registry = new SessionRegistry();
    const a = fakeClient("sA");
    registry.register("A", a);
    const repo = {
      async getAccountStatuses() {
        return new Map<string, string>(); // row vanished / not returned
      },
    };
    await new ThemisService(repo, registry, cfg).sweep();
    assert.deepEqual(a.left, [4403]);
  });
});
