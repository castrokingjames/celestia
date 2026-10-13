// index.ts — meta's COMPOSITION ROOT: the one place that names concrete adapters (guardrail #7)
// and wires them into the app. Constructs the DB client, stores, SessionService, and the enabled
// AuthMethod adapters (from config.auth.enabledMethods), then listens. Run: pnpm --filter @celestia/polaris dev
import { config } from "./config.js";
import { createDb } from "./db/client.js";
import { KyselyAccountStore } from "./accounts/kysely-account.store.js";
import { KyselyRefreshStore } from "./auth/kysely-refresh.store.js";
import { SessionService } from "./auth/session.service.js";
import { BasicAuthMethod } from "./auth/methods/basic.auth-method.js";
import type { AuthMethod } from "./auth/auth-method.port.js";
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

// Factory per known method id; only those listed in config.auth.enabledMethods get wired.
const available: Record<string, () => AuthMethod> = {
  basic: () => new BasicAuthMethod(config.basicAuthSecret),
};
const methods = new Map<string, AuthMethod>();
for (const id of config.auth.enabledMethods) {
  const make = available[id];
  if (!make) throw new Error(`config auth.enabledMethods references unknown method '${id}'`);
  methods.set(id, make());
}

const app = buildApp({ methods, accounts, sessions, corsOrigins: config.corsOrigins });
app
  .listen({ port: Number(process.env.PORT) || config.metaPort, host: "0.0.0.0" })
  .then((addr) => console.log(`[meta] listening on ${addr}  (methods: ${[...methods.keys()].join(", ")})`))
  .catch((err) => {
    console.error("[meta] failed to start:", err);
    process.exit(1);
  });
