// Headless end-to-end check (no browser): proves the full login→play path AND that the realtime
// server refuses unauthenticated joins. Start infra + meta + realtime first, then:
//   pnpm -C client/phaethon run smoke
// 1) join WITHOUT a ticket -> rejected by onAuth.
// 2) login via meta (our SDK) -> connect-ticket -> join -> send input -> authoritative x + lastSeq advance.
import { Client, getStateCallbacks } from "colyseus.js";
import { type InputCommand } from "@celestia/net-contract";
import { CelestiaAuth } from "../src/sdk/auth.js";

const WS = process.env.WS_URL ?? "ws://127.0.0.1:2567";
const META = process.env.META_URL ?? "http://127.0.0.1:3000";
const SECRET = process.env.BASIC_SECRET ?? "change-me-dev";

const client = new Client(WS);

// 1) no ticket -> join must be rejected.
let rejectedWithoutTicket = false;
try {
  const bad = await client.joinOrCreate("zone", {});
  await bad.leave();
} catch {
  rejectedWithoutTicket = true;
}
console.log(`[smoke] join without ticket rejected: ${rejectedWithoutTicket}`);

// 2) authenticated path via the SDK.
const auth = new CelestiaAuth(META);
const { account, created } = await auth.login("smoke", SECRET);
console.log(`[smoke] logged in as ${account.id} role=${account.role} (created=${created})`);
const ticket = await auth.connectTicket();

const room = await client.joinOrCreate("zone", { ticket });
const id = room.sessionId;
let myX = 0;
let myLastSeq = 0;

const $ = getStateCallbacks(room);
$(room.state).players.onAdd((p: any, key: string) => {
  if (key === id) $(p).onChange(() => { myX = p.x; myLastSeq = p.lastSeq; });
});

await new Promise((r) => setTimeout(r, 300));
let seq = 0;
for (let i = 0; i < 5; i++) {
  const cmd: InputCommand = { seq: ++seq, dx: 1, dy: 0, dt: 0.05 }; // move right
  room.send("input", cmd);
  await new Promise((r) => setTimeout(r, 60));
}
await new Promise((r) => setTimeout(r, 200));
console.log(`[smoke] self=${id}  x=${myX.toFixed(1)}  lastSeq=${myLastSeq}/${seq}`);
await room.leave();

const ok = rejectedWithoutTicket && myX > 0 && myLastSeq === seq;
console.log(`[smoke] result: ${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
