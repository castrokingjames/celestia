// config.ts — the config seam for meta. Non-secret values come from config/default.json;
// secrets + per-env values come from the environment (never inline). zod validates both so a
// bad/missing value fails loud at boot, not deep in a request. (Extracted to @celestia/config
// once a second service needs it — YAGNI until then.)
import { readFileSync } from "node:fs";
import { z } from "zod";

const fileSchema = z.object({
  env: z.string(),
  auth: z.object({
    enabledMethods: z.array(z.string()),
    accessTokenTtlSec: z.number(),
    refreshTokenTtlSec: z.number(),
    connectTicketTtlSec: z.number(),
  }),
  meta: z.object({
    port: z.number(),
    corsOrigins: z.array(z.string()),
  }),
  datastores: z.object({
    postgresUrlEnv: z.string(),
    valkeyUrlEnv: z.string(),
  }),
});

// repo-root/config/default.json, resolved relative to this module (cwd-independent).
const fileUrl = new URL("../../../config/default.json", import.meta.url);
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
    throw new Error(`${name} must be base64-encoded PEM — run: pnpm --filter @celestia/meta gen-dev-keys`);
  }
  return pem;
}

export const config = {
  env: file.env,
  auth: file.auth,
  metaPort: file.meta.port,
  databaseUrl: requireEnv(file.datastores.postgresUrlEnv), // config names the var; env holds the secret
  basicAuthSecret: requireEnv("BASIC_AUTH_SECRET"),
  jwtPrivateKeyPem: requireB64Pem("JWT_PRIVATE_KEY"),
  jwtPublicKeyPem: requireB64Pem("JWT_PUBLIC_KEY"),
  authTokenPepper: requireEnv("AUTH_TOKEN_PEPPER"),
  accessTokenTtlSec: file.auth.accessTokenTtlSec,
  refreshTokenTtlSec: file.auth.refreshTokenTtlSec,
  connectTicketTtlSec: file.auth.connectTicketTtlSec,
} as const;
