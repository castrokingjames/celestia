// Pure tests for the Themis decision cores — no DB, no Colyseus.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gateAccountStatus, selectRevoked, CODE_REVOKED } from "./revocation.js";

describe("gateAccountStatus", () => {
  it("when the account is active, then gateAccountStatus passes", () => {
    assert.deepEqual(gateAccountStatus("active"), { ok: true });
  });

  it("when the status is suspended / banned / missing / unknown, then gateAccountStatus fails closed", () => {
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
  it("when present accounts are not active or missing, then selectRevoked returns them (missing => revoked)", () => {
    const status = new Map([
      ["a", "active"],
      ["b", "banned"],
      ["c", "suspended"],
      // "d" absent → treated as revoked
    ]);
    assert.deepEqual(selectRevoked(["a", "b", "c", "d"], status).sort(), ["b", "c", "d"]);
  });

  it("when everyone present is active, then selectRevoked returns []", () => {
    const status = new Map([
      ["a", "active"],
      ["b", "active"],
    ]);
    assert.deepEqual(selectRevoked(["a", "b"], status), []);
  });
});
