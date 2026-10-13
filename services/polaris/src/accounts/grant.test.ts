// Acceptance tests for grantRole against the REAL Postgres. when/then naming.
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDb } from "../db/client.js";
import { KyselyAccountStore } from "./kysely-account.store.js";
import { findOrCreateAccount } from "./account.service.js";
import { grantRole } from "./grant.js";

const db = createDb();
const accounts = new KyselyAccountStore(db);
const newAccount = async () =>
  (await findOrCreateAccount(accounts, { method: "basic", externalId: `g_${randomUUID()}` })).account;

after(async () => {
  await db.destroy();
});

describe("grantRole", () => {
  it("when granting an active role, then the account's role is updated", async () => {
    const account = await newAccount();
    assert.equal(account.role, "terra");
    const res = await grantRole(db, account.id, "ignis");
    assert.equal(res.from, "terra");
    assert.equal(res.to, "ignis");
    assert.equal((await accounts.getById(account.id))?.role, "ignis");
  });

  it("when the role is unknown, then it throws", async () => {
    const account = await newAccount();
    await assert.rejects(() => grantRole(db, account.id, "nope"), /unknown role/);
  });

  it("when the role is reserved (inactive), then it refuses", async () => {
    const account = await newAccount();
    await assert.rejects(() => grantRole(db, account.id, "lux"), /reserved/); // lux is seeded active=false
  });

  it("when no account matches, then it throws", async () => {
    await assert.rejects(() => grantRole(db, "no-such-handle", "terra"), /no account/);
  });
});
