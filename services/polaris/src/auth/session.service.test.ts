// Acceptance tests for session-first SessionService against the REAL Postgres (run `pnpm --filter
// @celestia/polaris migrate` first). The badge signer is STUBBED (so the test is pure + needs no keys);
// the EdDSA sign/verify crypto is TicketService's concern. Data access via the one Repository (Kysely
// adapter). Naming: it("when <condition>, then <outcome>").
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDb, KyselyRepository } from "@celestia/firmament";
import { SessionService } from "./session.service.js";

const db = createDb();
const repo = new KyselyRepository(db);

let lastSigned: { accountId: string; role: string } | undefined;
const tickets = {
  async signAccessToken(claims: { accountId: string; role: string }): Promise<string> {
    lastSigned = claims;
    return `fake.access.badge.${claims.accountId}`;
  },
};

const makeSessions = () =>
  new SessionService({ pepper: "test-pepper", refreshTtlSec: 3600, accessTicketTtlSec: 30, repo, tickets });

const freshAccount = () => repo.createAccountWithIdentity({ method: "basic", externalId: `t_${randomUUID()}` });

after(async () => {
  await db.destroy();
});

describe("SessionService (session-first)", () => {
  it("when a session is issued, then it returns a rotating refresh + a one-time access badge (no access token)", async () => {
    const acc = await freshAccount();
    const session = await makeSessions().issue(acc);
    assert.ok(session.refreshToken, "has a refresh token");
    assert.equal(session.accessBadge, `fake.access.badge.${acc.id}`);
    assert.deepEqual(lastSigned, { accountId: acc.id, role: acc.role }, "badge signed with authoritative role");
    assert.ok(!("accessToken" in session), "no reusable access token is issued");
  });

  it("when a refresh token is exchanged, then it rotates to a new token and mints a new session", async () => {
    const acc = await freshAccount();
    const s = makeSessions();
    const first = await s.issue(acc);
    const { session: second } = await s.refresh(first.refreshToken);
    assert.notEqual(second.refreshToken, first.refreshToken, "refresh rotates");
    assert.ok(second.accessBadge, "a new access badge is minted on refresh");
  });

  it("when a spent refresh token is replayed, then reuse is detected and the chain is rejected", async () => {
    const acc = await freshAccount();
    const s = makeSessions();
    const first = await s.issue(acc);
    await s.refresh(first.refreshToken);
    await assert.rejects(() => s.refresh(first.refreshToken), /reuse detected/);
  });

  it("when the account is suspended, then refresh is rejected (ban-takes-effect-on-refresh)", async () => {
    const acc = await freshAccount();
    const s = makeSessions();
    const first = await s.issue(acc);
    await db.updateTable("account").set({ status: "suspended" }).where("id", "=", acc.id).execute();
    await assert.rejects(() => s.refresh(first.refreshToken), /not active/);
  });
});
