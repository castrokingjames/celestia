// app.ts — the meta HTTP surface (Fastify), wired purely over PORTS. It never names a concrete
// adapter (that's the composition root's job, src/index.ts — guardrail #7), so it's trivially
// testable via app.inject(). Routes:
//   GET  /health          liveness
//   POST /auth/:method     login == registration for an enabled AuthMethod -> { session, account, created }
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { AuthMethod } from "./auth/auth-method.port.js";
import type { AccountStore } from "./accounts/account.store.js";
import type { SessionService } from "./auth/session.service.js";
import { findOrCreateAccount } from "./accounts/account.service.js";

export interface AppDeps {
  /** Enabled login methods, keyed by id ('basic' now; 'discord'/... later) — only enabled ones are wired. */
  methods: Map<string, AuthMethod>;
  accounts: AccountStore;
  sessions: SessionService;
  /** Browser origins allowed to call this API (the client is a different origin). */
  corsOrigins: string[];
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  // Browser clients are cross-origin (the game page ≠ this API host), so allow the configured
  // origins. Registered before routes so the CORS hooks apply to all of them.
  app.register(cors, { origin: deps.corsOrigins });

  app.get("/health", async () => ({ status: "up" }));

  app.post("/auth/:method", async (req, reply) => {
    const method = deps.methods.get((req.params as { method: string }).method);
    if (!method) return reply.code(404).send({ error: "unknown or disabled auth method" });

    // The method verifies the credential. NOTE: req.body is NEVER read for role/privilege (G11) —
    // it only yields a VerifiedIdentity; role comes from authoritative account state below.
    let identity;
    try {
      identity = await method.complete(req.body);
    } catch {
      return reply.code(401).send({ error: "invalid credentials" });
    }

    const { account, created } = await findOrCreateAccount(deps.accounts, identity);
    const session = await deps.sessions.issue(account);
    return reply.code(200).send({
      session,
      account: { id: account.id, role: account.role, handle: account.handle },
      created,
    });
  });

  // Static routes win over the parametric /auth/:method in Fastify's router, so these don't clash.
  app.post("/auth/refresh", async (req, reply) => {
    const body = req.body as { refreshToken?: unknown };
    if (typeof body?.refreshToken !== "string") {
      return reply.code(400).send({ error: "expected { refreshToken }" });
    }
    try {
      const { tokens, account } = await deps.sessions.refresh(body.refreshToken);
      return reply.code(200).send({
        session: tokens,
        account: { id: account.id, role: account.role, handle: account.handle },
      });
    } catch {
      // invalid / expired / reuse-detected / inactive account — don't distinguish (no leak).
      return reply.code(401).send({ error: "invalid refresh token" });
    }
  });

  app.post("/auth/logout", async (req, reply) => {
    const body = req.body as { refreshToken?: unknown };
    if (typeof body?.refreshToken !== "string") {
      return reply.code(400).send({ error: "expected { refreshToken }" });
    }
    await deps.sessions.logout(body.refreshToken); // idempotent; always 204 (no token enumeration)
    return reply.code(204).send();
  });

  // Exchange a valid access token for a one-time connect-ticket to hand to the realtime server.
  app.post("/auth/ticket", async (req, reply) => {
    const authz = req.headers.authorization;
    const token = authz?.startsWith("Bearer ") ? authz.slice("Bearer ".length) : null;
    if (!token) return reply.code(401).send({ error: "missing bearer access token" });

    let claims;
    try {
      claims = await deps.sessions.verifyAccess(token);
    } catch {
      return reply.code(401).send({ error: "invalid access token" });
    }

    // Re-read authoritative account so role is fresh (G11) and a banned/suspended user gets no ticket.
    const account = await deps.accounts.getById(claims.sub);
    if (!account || account.status !== "active") {
      return reply.code(403).send({ error: "account not active" });
    }
    return reply.code(200).send(await deps.sessions.issueConnectTicket(account));
  });

  return app;
}
