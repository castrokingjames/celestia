// Pure unit tests for the refresh() status gate (ban-takes-effect-on-refresh) — stubbed repo + signer, no DB,
// so this runs under the sandbox gate (the DB-backed session.service.test.ts cannot). Complements the issue()
// gate test; together they cover both badge-minting paths.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SessionService, AccountNotActiveError } from "./session.service.js";
import type { RefreshRecord, Account } from "@celestia/firmament";

function freshRec(): RefreshRecord {
  return { id: "rid", accountId: "a1", expiresAt: new Date(Date.now() + 3_600_000), revokedAt: null, rotatedTo: null };
}

function make(opts: { rec?: RefreshRecord | null; account?: Account | null }) {
  const calls = { burned: 0, rotated: 0 };
  const repo = {
    async createRefresh() {
      return "r";
    },
    async findRefreshByHash() {
      return opts.rec ?? null;
    },
    async rotateRefresh() {
      calls.rotated++;
      return "r2";
    },
    async revokeRefreshByHash() {},
    async revokeAllRefreshForAccount() {
      calls.burned++;
    },
    async getAccountById() {
      return opts.account ?? null;
    },
  };
  const tickets = {
    async signAccessToken(claims: { accountId: string; role: string }) {
      return `badge.${claims.accountId}`;
    },
  };
  const svc = new SessionService({ pepper: "p", refreshTtlSec: 3600, accessTicketTtlSec: 30, repo, tickets });
  return { svc, calls };
}

const banned: Account = { id: "a1", handle: null, role: "terra", status: "banned" };
const active: Account = { id: "a1", handle: null, role: "terra", status: "active" };

describe("SessionService.refresh status gate", () => {
  it("refuses a banned account and burns the refresh chain (never rotates)", async () => {
    const { svc, calls } = make({ rec: freshRec(), account: banned });
    await assert.rejects(() => svc.refresh("whatever"), AccountNotActiveError);
    assert.equal(calls.burned, 1);
    assert.equal(calls.rotated, 0);
  });

  it("rotates + mints a new session for an active account", async () => {
    const { svc, calls } = make({ rec: freshRec(), account: active });
    const { session } = await svc.refresh("whatever");
    assert.ok(session.accessBadge);
    assert.equal(calls.rotated, 1);
  });
});
