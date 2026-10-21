// config.ts — the config seam, SHARED across services. Non-secret values come from config/default.json
// (zod-validated, loud at boot); secrets come from env and are resolved LAZILY (getters) so a service that
// doesn't need a given secret never throws — e.g. Atlas has no JWT_PRIVATE_KEY/BASIC_AUTH_SECRET and never
// touches them. Covers both the Polaris and Atlas (realtime) config sections.
import { readFileSync } from "node:fs";
import { z } from "zod";

const fileSchema = z.object({
  env: z.string(),
  auth: z.object({
    enabledMethods: z.array(z.string()),
    accessTokenTtlSec: z.number(),
    refreshTokenTtlSec: z.number(),
    accessTicketTtlSec: z.number(),
  }),
  polaris: z.object({
    port: z.number(),
    corsOrigins: z.array(z.string()),
  }),
  realtime: z.object({
    port: z.number(),
    tickHz: z.number(),
    patchRateHz: z.number(),
    maxClientsPerChannel: z.number(),
    publicUrl: z.string(), // where the client dials Atlas (returned in play.enter)
    autosaveIntervalSec: z.number(), // Atlas write-behind placement flush cadence
    revocationSweepSec: z.number(), // Themis cadence: how often Atlas sweeps live accounts for a landed ban
  }),
  // Game-module policy (per-game; config now, GameModule-declared later — PLATFORM.md §3.3).
  game: z.object({
    maxCharactersPerAccount: z.number().int().positive().nullable(), // null = unlimited
    startingZoneId: z.string(), // where a fresh character spawns (until placement continuity, #20)
  }),
  datastores: z.object({
    postgresUrlEnv: z.string(), // admin/owner URL — migrations + role management + the grant CLI
    polarisPostgresUrlEnv: z.string(), // Polaris app role (RW identity/auth)
    atlasPostgresUrlEnv: z.string(), // Atlas app role (RW game data; NO write on auth)
    valkeyUrlEnv: z.string(),
  }),
});

/** Which service's least-privilege DB role to resolve a connection string for (write-ownership split —
 *  docs/REFACTOR.md S1 move 6). */
export type DbService = "polaris" | "atlas";

// repo-root/config/default.json, resolved relative to this module (cwd-independent):
//   packages/firmament/src/config/config.ts → up 4 → repo root.
const fileUrl = new URL("../../../../config/default.json", import.meta.url);
const file = fileSchema.parse(JSON.parse(readFileSync(fileUrl, "utf8")));

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env ${name} (copy .env.example to .env and fill it)`);
  return v;
}

// JWT keys live in env as base64-encoded PEM (single line — dodges multi-line env parsing).
function requireB64Pem(name: string): string {
  const pem = Buffer.from(requireEnv(name), "base64").toString("utf8");
  if (!pem.includes("-----BEGIN")) {
    throw new Error(`${name} must be base64-encoded PEM — run: pnpm --filter @celestia/polaris gen-dev-keys`);
  }
  return pem;
}

// corsOrigins = DEV defaults from config/default.json (localhost) + any DEPLOY origins from the
// POLARIS_CORS_ORIGINS env var (comma-separated), merged + deduped. So a new client URL in prod is an env
// change + restart, never a committed code edit. Order preserved; blanks trimmed.
function resolveCorsOrigins(base: string[], env: string | undefined): string[] {
  const extra = (env ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([...base, ...extra])];
}

export const config = {
  env: file.env,
  auth: file.auth,
  polarisPort: file.polaris.port,
  corsOrigins: resolveCorsOrigins(file.polaris.corsOrigins, process.env.POLARIS_CORS_ORIGINS),
  realtimePort: file.realtime.port,
  tickHz: file.realtime.tickHz,
  patchRateHz: file.realtime.patchRateHz,
  maxClientsPerChannel: file.realtime.maxClientsPerChannel,
  accessTokenTtlSec: file.auth.accessTokenTtlSec,
  refreshTokenTtlSec: file.auth.refreshTokenTtlSec,
  accessTicketTtlSec: file.auth.accessTicketTtlSec,
  maxCharactersPerAccount: file.game.maxCharactersPerAccount,
  startingZoneId: file.game.startingZoneId,
  realtimeUrl: file.realtime.publicUrl,
  autosaveIntervalSec: file.realtime.autosaveIntervalSec,
  revocationSweepSec: file.realtime.revocationSweepSec,
  // Secrets — LAZY (only resolved on access): config names the env var; env holds the secret (G8).
  /** The connection string for a SERVICE's own least-privilege role (write-ownership enforcement). In dev,
   *  falls back to the admin DATABASE_URL when the per-service var is unset (single-URL convenience). ANYWHERE
   *  ELSE this fallback is REFUSED and boot fails loud — connecting as the table OWNER would silently void the
   *  GRANT split (Atlas could then write auth tables / mutate the append-only log). docs/REFACTOR.md S1 move 6. */
  databaseUrlFor(service: DbService): string {
    const envName =
      service === "polaris" ? file.datastores.polarisPostgresUrlEnv : file.datastores.atlasPostgresUrlEnv;
    const url = process.env[envName];
    if (url) return url;
    if (file.env !== "dev") {
      throw new Error(
        `${envName} is required when env="${file.env}": refusing to fall back to the admin DATABASE_URL, which would void the per-service write-ownership GRANT split`,
      );
    }
    return requireEnv(file.datastores.postgresUrlEnv);
  },
  // Admin/owner URL — migrations, role management, the grant CLI (createDb() default).
  get databaseUrl(): string {
    return requireEnv(file.datastores.postgresUrlEnv);
  },
  get basicAuthSecret(): string {
    return requireEnv("BASIC_AUTH_SECRET");
  },
  get jwtPrivateKeyPem(): string {
    return requireB64Pem("JWT_PRIVATE_KEY");
  },
  get jwtPublicKeyPem(): string {
    return requireB64Pem("JWT_PUBLIC_KEY");
  },
  get authTokenPepper(): string {
    return requireEnv("AUTH_TOKEN_PEPPER");
  },
};
