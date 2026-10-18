// Pure unit tests for the issue() status gate — no DB, no keys (stubbed repo + signer), so they run under the
// sandbox gate (the sibling session.service.test.ts is DB-backed acceptance and needs Postgres). Verifies the
// login gap is closed: a banned/suspended account cannot mint a fresh badge, and no refresh is created.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SessionService, AccountNotActiveError } from "./session.service.js";

function make() {
  let createRefreshCalls = 0;
  const repo = {
    async createRefresh() {
      createRefreshCalls++;
      return "refresh-id";
    },
    async findRefreshByHash() {
      return null;
    },
    async rotateRefresh() {
      return "refresh-id-2";
    },
    async revokeRefreshByHash() {},
    async revokeAllRefreshForAccount() {},
    async getAccountById() {
      return null;
    },
  };
  const tickets = {
    async signAccessToken(claims: { accountId: string; role: string }) {
      return `badge.${claims.accountId}`;
    },
  };
  const svc = new SessionService({ pepper: "p", refreshTtlSec: 3600, accessTicketTtlSec: 30, repo, tickets });
  return { svc, refreshCalls: () => createRefreshCalls };
}

describe("SessionService.issue status gate", () => {
  it("when the account is active, then it mints a session (refresh + badge)", async () => {
    const { svc, refreshCalls } = make();
    const s = await svc.issue({ id: "a1", role: "terra", status: "active" });
    assert.ok(s.refreshToken);
    assert.equal(s.accessBadge, "badge.a1");
    assert.equal(refreshCalls(), 1);
  });

  it("when the account is banned, then issue is refused and NO refresh is minted", async () => {
    const { svc, refreshCalls } = make();
    await assert.rejects(() => svc.issue({ id: "a1", role: "terra", status: "banned" }), AccountNotActiveError);
    assert.equal(refreshCalls(), 0);
  });

  it("when the account is suspended, then issue is refused and NO refresh is minted", async () => {
    const { svc, refreshCalls } = make();
    await assert.rejects(() => svc.issue({ id: "a1", role: "terra", status: "suspended" }), AccountNotActiveError);
    assert.equal(refreshCalls(), 0);
  });
});
