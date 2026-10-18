// grant.ts — server-local admin CLI: set an account's role (bootstrap the first `ignis`, promote others).
// DB-direct via the one Repository, no network path, no shareable secret — elevation requires shell/DB
// access to the box (G11). Usage: pnpm --filter @celestia/polaris grant <handle|accountId> <role>
import { createDb, KyselyRepository } from "@celestia/firmament";
import { grantRole } from "../src/accounts/grant.js";

const [identifier, role] = process.argv.slice(2);
if (!identifier || !role) {
  console.error("usage: grant <handle|accountId> <role>");
  process.exit(1);
}

const db = createDb();
const repo = new KyselyRepository(db);
try {
  const res = await grantRole(repo, identifier, role);
  console.log(`[grant] ${res.accountId} (handle=${res.handle ?? "null"}): ${res.from} -> ${res.to}`);
} catch (err) {
  console.error(`[grant] ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
