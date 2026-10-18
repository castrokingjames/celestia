// ban.ts — server-local admin CLI: set an account's status (ban/suspend/unban). DB-direct via the one
// Repository, no network path, no shareable secret — enforcement requires shell/DB access to the box (G11).
// Usage: pnpm --filter @celestia/polaris ban <handle|accountId> <active|suspended|banned>
import { createDb, KyselyRepository } from "@celestia/firmament";
import { banAccount, type AccountStatus } from "../src/accounts/ban.js";

const [identifier, status] = process.argv.slice(2);
if (!identifier || !status) {
  console.error("usage: ban <handle|accountId> <active|suspended|banned>");
  process.exit(1);
}

const db = createDb();
const repo = new KyselyRepository(db);
try {
  const res = await banAccount(repo, identifier, status as AccountStatus);
  console.log(`[ban] ${res.accountId} (handle=${res.handle ?? "null"}) -> ${res.to}`);
} catch (err) {
  console.error(`[ban] ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
