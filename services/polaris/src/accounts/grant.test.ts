// Acceptance tests for grantRole against the REAL Postgres. when/then naming. Data access via the one
// Repository (Kysely adapter).
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDb, KyselyRepository } from "@celestia/firmament";
import { findOrCreateAccount } from "./account.service.js";
import { grantRole } from "./grant.js";

const db = createDb();
const repo = new KyselyRepository(db);
const newAccount = async () =>
  (await findOrCreateAccount(repo, { method: "basic", externalId: `g_${randomUUID()}` })).account;

after(async () => {
  await db.destroy();
});

describe("grantRole", () => {
  it("when granting an active role, then the account's role is updated", async () => {
    const account = await newAccount();
    assert.equal(account.role, "terra");
    const res = await grantRole(repo, account.id, "ignis");
    assert.equal(res.from, "terra");
    assert.equal(res.to, "ignis");
    assert.equal((await repo.getAccountById(account.id))?.role, "ignis");
  });

  it("when the role is unknown, then it throws", async () => {
    const account = await newAccount();
    await assert.rejects(() => grantRole(repo, account.id, "nope"), /unknown role/);
  });

  it("when the role is reserved (inactive), then it refuses", async () => {
    const account = await newAccount();
    await assert.rejects(() => grantRole(repo, account.id, "lux"), /reserved/); // lux is seeded active=false
  });

  it("when no account matches, then it throws", async () => {
    await assert.rejects(() => grantRole(repo, "no-such-handle", "terra"), /no account/);
  });
});
