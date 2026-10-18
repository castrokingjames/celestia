// Pure unit test for the login HTTP contract (the "login gap" feature): AccountNotActiveError → 403. The
// controller is a plain class, so we construct it with stubs (no Nest harness, no DB). This covers the mapping
// that the DB-backed path can't verify in the sandbox.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ForbiddenException } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { AccountNotActiveError } from "./session.service.js";
import type { SessionService } from "./session.service.js";
import type { AccountsService } from "../accounts/accounts.service.js";
import type { AuthMethod } from "./auth-method.port.js";

function ctrlFor(status: string): AuthController {
  const methods = new Map<string, AuthMethod>([
    [
      "basic",
      {
        id: "basic",
        async complete() {
          return { method: "basic", externalId: "u" };
        },
      },
    ],
  ]);
  const account = { id: "a1", handle: null, role: "terra", status };
  const accounts = {
    async findOrCreate() {
      return { account, created: false };
    },
  } as unknown as AccountsService;
  const sessions = {
    async issue(a: { status: string }) {
      if (a.status !== "active") throw new AccountNotActiveError(); // mirror the real gate
      return { refreshToken: "r", refreshExpiresInSec: 1, accessBadge: "b", accessBadgeExpiresInSec: 1 };
    },
  } as unknown as SessionService;
  return new AuthController(methods, sessions, accounts);
}

describe("AuthController.login status mapping", () => {
  it("maps AccountNotActiveError to 403 Forbidden for a banned account", async () => {
    await assert.rejects(
      () => ctrlFor("banned").login("basic", { username: "u", secret: "s" }),
      ForbiddenException,
    );
  });

  it("returns a session + account for an active account", async () => {
    const res = await ctrlFor("active").login("basic", { username: "u", secret: "s" });
    assert.equal(res.account.id, "a1");
    assert.ok(res.session.accessBadge);
  });
});
