import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSilentCredential, resolveSilentCredentials, type CredentialStore, type SilentCredential } from "./identity.js";

function memStore(): CredentialStore & { readonly raw: SilentCredential | null } {
  let v: SilentCredential | null = null;
  return {
    load: () => v,
    save: (c) => {
      v = c;
    },
    get raw() {
      return v;
    },
  };
}

test("when no credential is cached, then resolve generates and persists one", () => {
  const s = memStore();
  const c = resolveSilentCredentials(s);
  assert.ok(c.username.startsWith("guest-"), "uid is a guest id");
  assert.ok(c.password.length >= 32, "password is high-entropy");
  assert.deepEqual(s.raw, c, "the fresh credential was persisted");
});

test("when a credential is cached, then resolve returns it unchanged (stable across runs)", () => {
  const s = memStore();
  const first = resolveSilentCredentials(s);
  const second = resolveSilentCredentials(s);
  assert.deepEqual(second, first);
});

test("when generating twice, then each credential is unique (random uid + password)", () => {
  const a = generateSilentCredential();
  const b = generateSilentCredential();
  assert.notEqual(a.username, b.username);
  assert.notEqual(a.password, b.password);
});
