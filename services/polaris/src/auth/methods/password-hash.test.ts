import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "./password-hash.js";

const PEPPER = "test-pepper";

test("when a password is hashed, then verify accepts it and rejects a wrong one", async () => {
  const h = await hashPassword("correct horse battery staple", PEPPER);
  assert.match(h, /^scrypt\$\d+\$\d+\$\d+\$[^$]+\$[^$]+$/);
  assert.equal(await verifyPassword("correct horse battery staple", h, PEPPER), true);
  assert.equal(await verifyPassword("wrong", h, PEPPER), false);
});

test("when the pepper differs, then verify fails (the pepper is required, not just the DB row — G8)", async () => {
  const h = await hashPassword("s3cret-password", PEPPER);
  assert.equal(await verifyPassword("s3cret-password", h, "other-pepper"), false);
});

test("when the stored string is malformed, then verify returns false and never throws", async () => {
  for (const bad of ["", "nope", "scrypt$x$y", "bcrypt$1$2$3$a$b", "scrypt$16384$8$1$$"]) {
    assert.equal(await verifyPassword("whatever", bad, PEPPER), false);
  }
});

test("when the same password is hashed twice, then the hashes differ (per-hash random salt)", async () => {
  const a = await hashPassword("same-password", PEPPER);
  const b = await hashPassword("same-password", PEPPER);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("same-password", a, PEPPER), true);
  assert.equal(await verifyPassword("same-password", b, PEPPER), true);
});
