// Acceptance tests for find-or-create against the REAL Postgres (run `pnpm --filter @celestia/polaris
// migrate` first). Naming convention: describe(<unit>) + it("when <condition>, then <outcome>"),
// one behavior per case. Random external id per run so repeated runs don't collide.
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDb } from "../db/client.js";
import { KyselyAccountStore } from "./kysely-account.store.js";
import { findOrCreateAccount } from "./account.service.js";

const db = createDb();
const store = new KyselyAccountStore(db);

const newIdentity = () => ({ method: "basic", externalId: `t_${randomUUID()}`, suggestedHandle: "Tester" });

after(async () => {
  await db.destroy();
});

describe("findOrCreateAccount (basic login)", () => {
  it("when a new identity signs in, then it creates an account at the terra tier (created=true)", async () => {
    const { account, created } = await findOrCreateAccount(store, newIdentity());
    assert.equal(created, true);
    assert.equal(account.role, "terra", "new accounts default to the terra tier");
    assert.equal(account.status, "active");
    assert.equal(account.handle, null, "handle is chosen later in onboarding, not derived from login");
  });

  it("when a known identity signs in again, then it returns the same account (created=false)", async () => {
    const identity = newIdentity();
    const { account: first } = await findOrCreateAccount(store, identity);
    const { account: second, created } = await findOrCreateAccount(store, identity);
    assert.equal(created, false);
    assert.equal(second.id, first.id, "same identity must resolve to the same account");
  });
});
