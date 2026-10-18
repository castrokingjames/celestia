// Pure unit tests for banAccount — stubbed repo (no DB). Mirrors grant.test.ts naming (when/then).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { banAccount } from "./ban.js";

function makeRepo(account: { id: string; handle: string | null; role: string } | null) {
  const calls: { setStatus: Array<[string, string]>; burned: string[] } = { setStatus: [], burned: [] };
  const repo = {
    async findAccountByHandleOrId() {
      return account;
    },
    async setAccountStatus(id: string, status: string) {
      calls.setStatus.push([id, status]);
    },
    async revokeAllRefreshForAccount(id: string) {
      calls.burned.push(id);
    },
  };
  return { repo, calls };
}

describe("banAccount", () => {
  it("when banning, then it sets status='banned' AND burns the refresh chain", async () => {
    const { repo, calls } = makeRepo({ id: "a1", handle: "neo", role: "terra" });
    const res = await banAccount(repo, "neo", "banned");
    assert.deepEqual(res, { accountId: "a1", handle: "neo", to: "banned" });
    assert.deepEqual(calls.setStatus, [["a1", "banned"]]);
    assert.deepEqual(calls.burned, ["a1"]);
  });

  it("when suspending, then it also burns the refresh chain", async () => {
    const { repo, calls } = makeRepo({ id: "a1", handle: null, role: "terra" });
    await banAccount(repo, "a1", "suspended");
    assert.deepEqual(calls.setStatus, [["a1", "suspended"]]);
    assert.deepEqual(calls.burned, ["a1"]);
  });

  it("when unbanning (active), then it sets status but does NOT burn the chain", async () => {
    const { repo, calls } = makeRepo({ id: "a1", handle: "neo", role: "terra" });
    await banAccount(repo, "neo", "active");
    assert.deepEqual(calls.setStatus, [["a1", "active"]]);
    assert.deepEqual(calls.burned, []);
  });

  it("when the identifier matches no account, then it throws", async () => {
    const { repo } = makeRepo(null);
    await assert.rejects(() => banAccount(repo, "ghost", "banned"), /no account with handle or id/);
  });

  it("when the status is invalid, then it throws before touching the repo", async () => {
    const { repo, calls } = makeRepo({ id: "a1", handle: "neo", role: "terra" });
    // @ts-expect-error — exercising the runtime guard with an out-of-range status
    await assert.rejects(() => banAccount(repo, "neo", "nuked"), /invalid status/);
    assert.deepEqual(calls.setStatus, []);
  });
});
