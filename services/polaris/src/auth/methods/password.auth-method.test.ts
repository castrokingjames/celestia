import { test } from "node:test";
import assert from "node:assert/strict";
import { PasswordAuthMethod, type CredentialReader } from "./password.auth-method.js";

const PEPPER = "test-pepper";

/** In-memory credential store standing in for the Repository's getIdentitySecretHash + the core's persist-on-create. */
function store(): CredentialReader & { set(externalId: string, hash: string): void } {
  const map = new Map<string, string>();
  return {
    async getIdentitySecretHash(_method, externalId) {
      return map.get(externalId) ?? null;
    },
    set(externalId, hash) {
      map.set(externalId, hash);
    },
  };
}

test("when a username logs in for the first time, then it registers (carries a secretHash to persist)", async () => {
  const m = new PasswordAuthMethod({ pepper: PEPPER, credentials: store() });
  const id = await m.complete({ username: "Hero", password: "a-long-random-pw" });
  assert.equal(id.method, "password");
  assert.equal(id.externalId, "hero"); // normalized lower-case so casing can't fork accounts
  assert.equal(id.suggestedHandle, "Hero");
  assert.ok(id.secretHash, "first login hands the hash to the core to persist");
});

test("when the same credential returns, then it verifies and carries NO secretHash", async () => {
  const s = store();
  const m = new PasswordAuthMethod({ pepper: PEPPER, credentials: s });
  const first = await m.complete({ username: "hero", password: "a-long-random-pw" });
  s.set("hero", first.secretHash!); // simulate createAccountWithIdentity persisting it
  const second = await m.complete({ username: "hero", password: "a-long-random-pw" });
  assert.equal(second.externalId, "hero");
  assert.equal(second.secretHash, undefined); // existing identity → nothing to persist
});

test("when the password is wrong on return, then complete() throws (controller maps to a generic 401)", async () => {
  const s = store();
  const m = new PasswordAuthMethod({ pepper: PEPPER, credentials: s });
  const first = await m.complete({ username: "hero", password: "a-long-random-pw" });
  s.set("hero", first.secretHash!);
  await assert.rejects(() => m.complete({ username: "hero", password: "WRONG-password" }));
});

test("when the input is malformed / empty-username / too-short, then it throws", async () => {
  const m = new PasswordAuthMethod({ pepper: PEPPER, credentials: store() });
  await assert.rejects(() => m.complete({ username: "hero" })); // no password
  await assert.rejects(() => m.complete({ username: "   ", password: "a-long-random-pw" })); // empty username
  await assert.rejects(() => m.complete({ username: "hero", password: "short" })); // below min length
  await assert.rejects(() => m.complete("nope")); // not an object
});
