// gen-dev-keys.ts — generate a dev Ed25519 keypair (base64-encoded PEM) into the repo-root .env.
// DEV CONVENIENCE ONLY — production keys come from a secret manager, never from this. Idempotent:
// skips if JWT_PRIVATE_KEY is already set unless --force is passed. Run:
//   pnpm --filter @celestia/polaris gen-dev-keys [--force]
import { generateKeyPairSync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
const force = process.argv.includes("--force");

let env: string;
try {
  env = readFileSync(envPath, "utf8");
} catch {
  console.error("[gen-dev-keys] no .env found — copy .env.example to .env first");
  process.exit(1);
}

if (/^JWT_PRIVATE_KEY=.+$/m.test(env) && !force) {
  console.log("[gen-dev-keys] JWT keys already present in .env — pass --force to regenerate. Skipping.");
  process.exit(0);
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const privB64 = Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" }).toString()).toString("base64");
const pubB64 = Buffer.from(publicKey.export({ type: "spki", format: "pem" }).toString()).toString("base64");

const setVar = (src: string, key: string, val: string): string => {
  const line = `${key}=${val}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  return re.test(src) ? src.replace(re, line) : `${src.replace(/\n*$/, "")}\n${line}\n`;
};

let next = setVar(env, "JWT_PRIVATE_KEY", privB64);
next = setVar(next, "JWT_PUBLIC_KEY", pubB64);
writeFileSync(envPath, next);

console.log("[gen-dev-keys] wrote Ed25519 JWT_PRIVATE_KEY/JWT_PUBLIC_KEY (base64 PEM) to .env");
