// HTTP-level tests for the meta app via Fastify's in-process inject() (no real port), hitting the
// REAL Postgres + dev keypair. Run `gen-dev-keys` + `migrate` first. when/then naming.
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { createDb } from "./db/client.js";
import { KyselyAccountStore } from "./accounts/kysely-account.store.js";
import { KyselyRefreshStore } from "./auth/kysely-refresh.store.js";
import { SessionService } from "./auth/session.service.js";
import { BasicAuthMethod } from "./auth/methods/basic.auth-method.js";
import { buildApp } from "./app.js";

const db = createDb();
const accounts = new KyselyAccountStore(db);
const sessions = new SessionService({
  privateKeyPem: config.jwtPrivateKeyPem,
  publicKeyPem: config.jwtPublicKeyPem,
  pepper: config.authTokenPepper,
  accessTtlSec: config.accessTokenTtlSec,
  refreshTtlSec: config.refreshTokenTtlSec,
  connectTicketTtlSec: config.connectTicketTtlSec,
  refreshStore: new KyselyRefreshStore(db),
  accounts,
});
const app = buildApp({
  methods: new Map([["basic", new BasicAuthMethod(config.basicAuthSecret)]]),
  accounts,
  sessions,
});

const user = () => `http_${randomUUID()}`;

/** Log in a fresh account and return the parsed response body ({ session, account, created }). */
async function login() {
  const res = await app.inject({
    method: "POST",
    url: "/auth/basic",
    payload: { username: user(), secret: config.basicAuthSecret },
  });
  return res.json();
}

after(async () => {
  await app.close();
  await db.destroy();
});

describe("GET /health", () => {
  it("when pinged, then it returns 200 status up", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().status, "up");
  });
});

describe("POST /auth/basic", () => {
  it("when valid credentials are posted, then it returns a terra session with a verifiable access token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/basic",
      payload: { username: user(), secret: config.basicAuthSecret },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.created, true);
    assert.equal(body.account.role, "terra");
    const claims = await sessions.verifyAccess(body.session.accessToken);
    assert.equal(claims.sub, body.account.id);
    assert.equal(claims.role, "terra");
  });

  it("when a role is smuggled into the body, then it is ignored and the session stays terra", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/basic",
      payload: { username: user(), secret: config.basicAuthSecret, role: "ignis" },
    });
    const body = res.json();
    assert.equal(body.account.role, "terra", "G11: client-supplied role must not elevate");
    const claims = await sessions.verifyAccess(body.session.accessToken);
    assert.equal(claims.role, "terra");
  });

  it("when the secret is wrong, then it returns 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/basic",
      payload: { username: user(), secret: "WRONG" },
    });
    assert.equal(res.statusCode, 401);
  });

  it("when the method is unknown, then it returns 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/discord",
      payload: { username: user(), secret: config.basicAuthSecret },
    });
    assert.equal(res.statusCode, 404);
  });
});

describe("POST /auth/refresh", () => {
  it("when a valid refresh token is posted, then it returns a new rotated session", async () => {
    const { session } = await login();
    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: session.refreshToken },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.notEqual(body.session.refreshToken, session.refreshToken, "the refresh token rotates");
    assert.ok(body.session.accessToken);
  });

  it("when a spent refresh token is replayed, then it returns 401", async () => {
    const { session } = await login();
    await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken: session.refreshToken } });
    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: session.refreshToken },
    });
    assert.equal(res.statusCode, 401);
  });
});

describe("POST /auth/logout", () => {
  it("when a session is logged out, then its refresh token can no longer be used (401)", async () => {
    const { session } = await login();
    const out = await app.inject({ method: "POST", url: "/auth/logout", payload: { refreshToken: session.refreshToken } });
    assert.equal(out.statusCode, 204);
    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: session.refreshToken },
    });
    assert.equal(res.statusCode, 401);
  });

  it("when logout is called with an unknown token, then it still returns 204 (idempotent, no enumeration)", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/logout", payload: { refreshToken: "not-a-real-token" } });
    assert.equal(res.statusCode, 204);
  });
});

describe("POST /auth/ticket", () => {
  it("when a valid access token is presented, then it returns a connect-ticket", async () => {
    const { session } = await login();
    const res = await app.inject({
      method: "POST",
      url: "/auth/ticket",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.ticket, "a ticket is returned");
    assert.ok(body.expiresInSec > 0);
  });

  it("when no bearer token is sent, then it returns 401", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/ticket" });
    assert.equal(res.statusCode, 401);
  });

  it("when the access token is invalid, then it returns 401", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/ticket", headers: { authorization: "Bearer not.a.jwt" } });
    assert.equal(res.statusCode, 401);
  });
});
