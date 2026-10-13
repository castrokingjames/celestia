// SessionService acceptance tests against the REAL Postgres + the dev keypair in .env
// (run `pnpm --filter @celestia/polaris gen-dev-keys` + `migrate` first). when/then naming.
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { createDb } from "../db/client.js";
import { KyselyAccountStore } from "../accounts/kysely-account.store.js";
import { findOrCreateAccount } from "../accounts/account.service.js";
import { KyselyRefreshStore } from "./kysely-refresh.store.js";
import { SessionService } from "./session.service.js";
import { jwtVerify, importSPKI } from "jose";
import { CONNECT_TICKET_AUD } from "@celestia/net-contract";

const db = createDb();
const accounts = new KyselyAccountStore(db);
const svc = new SessionService({
  privateKeyPem: config.jwtPrivateKeyPem,
  publicKeyPem: config.jwtPublicKeyPem,
  pepper: config.authTokenPepper,
  accessTtlSec: config.accessTokenTtlSec,
  refreshTtlSec: config.refreshTokenTtlSec,
  connectTicketTtlSec: config.connectTicketTtlSec,
  refreshStore: new KyselyRefreshStore(db),
  accounts,
});

const newAccount = async () =>
  (await findOrCreateAccount(accounts, { method: "basic", externalId: `s_${randomUUID()}` })).account;

after(async () => {
  await db.destroy();
});

describe("SessionService", () => {
  it("when a session is issued, then the access token verifies with the public key and carries sub + role", async () => {
    const account = await newAccount();
    const { accessToken } = await svc.issue(account);
    const claims = await svc.verifyAccess(accessToken);
    assert.equal(claims.sub, account.id);
    assert.equal(claims.role, "terra");
  });

  it("when an access token is tampered, then verification is rejected", async () => {
    const account = await newAccount();
    const { accessToken } = await svc.issue(account);
    const parts = accessToken.split(".");
    // Corrupt the FIRST signature char — fully significant, so the bytes always change (the last
    // base64url char only carries padding bits for a 64-byte sig, which made this flaky).
    parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
    await assert.rejects(() => svc.verifyAccess(parts.join(".")));
  });

  it("when a refresh token is exchanged, then it rotates to a new token and the chain continues", async () => {
    const account = await newAccount();
    const { refreshToken: r0 } = await svc.issue(account);
    const { tokens: t1 } = await svc.refresh(r0);
    assert.notEqual(t1.refreshToken, r0, "a new refresh token is issued");
    const { tokens: t2 } = await svc.refresh(t1.refreshToken);
    assert.ok(t2.accessToken, "the rotated token keeps working");
  });

  it("when a spent refresh token is replayed, then reuse is detected and rejected", async () => {
    const account = await newAccount();
    const { refreshToken: r0 } = await svc.issue(account);
    await svc.refresh(r0); // r0 is now rotated/spent
    await assert.rejects(() => svc.refresh(r0), /reuse/, "replaying the spent token is rejected");
  });

  it("when a connect-ticket is issued, then it verifies with aud=realtime and carries the account", async () => {
    const account = await newAccount();
    const { ticket, expiresInSec } = await svc.issueConnectTicket(account);
    assert.ok(expiresInSec > 0);
    const { payload } = await jwtVerify(ticket, await importSPKI(config.jwtPublicKeyPem, "EdDSA"), {
      audience: CONNECT_TICKET_AUD,
      algorithms: ["EdDSA"],
    });
    assert.equal(payload.sub, account.id);
    assert.equal(payload.role, "terra");
  });

  it("when the account is suspended, then refresh is rejected", async () => {
    const account = await newAccount();
    const { refreshToken } = await svc.issue(account);
    await db.updateTable("account").set({ status: "suspended" }).where("id", "=", account.id).execute();
    await assert.rejects(() => svc.refresh(refreshToken), /not active/, "a suspended account can't refresh");
  });
});
