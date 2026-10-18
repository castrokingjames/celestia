// Pure tests for the Themis decision cores — no DB, no Colyseus.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gateAccountStatus, selectRevoked, CODE_REVOKED } from "./revocation.js";

describe("gateAccountStatus", () => {
  it("passes an active account", () => {
    assert.deepEqual(gateAccountStatus("active"), { ok: true });
  });

  it("fails closed for suspended / banned / missing / unknown", () => {
    for (const s of ["suspended", "banned", "", "weird"]) {
      const r = gateAccountStatus(s);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.code, CODE_REVOKED);
    }
    for (const s of [null, undefined]) {
      const r = gateAccountStatus(s);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, "account_unknown");
    }
  });
});

describe("selectRevoked", () => {
  it("returns present accounts whose status is not active (missing => revoked)", () => {
    const status = new Map([
      ["a", "active"],
      ["b", "banned"],
      ["c", "suspended"],
      // "d" absent → treated as revoked
    ]);
    assert.deepEqual(selectRevoked(["a", "b", "c", "d"], status).sort(), ["b", "c", "d"]);
  });

  it("returns [] when everyone present is active", () => {
    const status = new Map([
      ["a", "active"],
      ["b", "active"],
    ]);
    assert.deepEqual(selectRevoked(["a", "b"], status), []);
  });
});
