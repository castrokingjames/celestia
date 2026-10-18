// Headless e2e (no browser): the full session-first path. login -> bound session -> create/select a
// character -> play.enter -> connect Atlas with the one-time zone ticket -> move -> position advances AND
// PERSISTS across a reconnect (proves placement write-behind). Also: Atlas refuses a no-ticket join.
// Start infra + polaris + atlas first:  pnpm -C client/phaethon run smoke
import { Client, getStateCallbacks } from "colyseus.js";
import { PROTOCOL_VERSION, type InputCommand } from "@celestia/norma";
import { login, SessionConnection, type PlayEnterResult } from "../src/sdk/session.js";

const POLARIS = process.env.POLARIS_URL ?? "http://127.0.0.1:3000";
const POLARIS_WS = POLARIS.replace(/^http/, "ws");
const SECRET = process.env.BASIC_SECRET ?? "change-me-dev";

/** login -> bound session -> ensure a character -> play.enter -> zone ticket. */
async function enterWorld(): Promise<PlayEnterResult> {
  const { sessionTicket } = await login(POLARIS, "smoke", SECRET);
  const session = new SessionConnection(POLARIS_WS, sessionTicket);
  await session.ready();
  const enter = await new Promise<PlayEnterResult>((resolve) => {
    session.onState((state) => {
      if (state.characters.length === 0) session.create(`Smoke_${Math.random().toString(36).slice(2, 7)}`);
      else void session.enter(state.characters[0].id).then(resolve);
    });
  });
  session.close();
  return enter;
}

async function main(): Promise<void> {
  const enter = await enterWorld();
  console.log(`[smoke] entered zone=${enter.zoneId} via ${enter.realtimeUrl}`);
  const atlas = new Client(enter.realtimeUrl);

  // 1) no-ticket join must be rejected by onAuth.
  let rejected = false;
  try {
    const bad = await atlas.joinOrCreate("zone", {});
    await bad.leave();
  } catch {
    rejected = true;
  }
  console.log(`[smoke] join without ticket rejected: ${rejected}`);

  // 2) authenticated join + move.
  const room = await atlas.joinOrCreate("zone", { protocolVersion: PROTOCOL_VERSION, ticket: enter.zoneTicket });
  const id = room.sessionId;
  let myX = 0;
  let myLastSeq = 0;
  const $ = getStateCallbacks(room);
  $(room.state).players.onAdd((p: any, key: string) => {
    if (key === id) $(p).onChange(() => { myX = p.x; myLastSeq = p.lastSeq; });
  });
  await new Promise((r) => setTimeout(r, 300));
  let seq = 0;
  for (let i = 0; i < 6; i++) {
    room.send("input", { seq: ++seq, dx: 1, dy: 0, dt: 0.05 } as InputCommand);
    await new Promise((r) => setTimeout(r, 60));
  }
  await new Promise((r) => setTimeout(r, 200));
  const movedX = myX;
  console.log(`[smoke] moved x=${movedX.toFixed(1)} lastSeq=${myLastSeq}/${seq}`);
  await room.leave(); // triggers the write-behind placement save
  await new Promise((r) => setTimeout(r, 600)); // let the save land

  // 3) reconnect -> spawn should be at the PERSISTED position, not the origin.
  const enter2 = await enterWorld();
  const room2 = await atlas.joinOrCreate("zone", { protocolVersion: PROTOCOL_VERSION, ticket: enter2.zoneTicket });
  let spawnX = 0;
  const $2 = getStateCallbacks(room2);
  $2(room2.state).players.onAdd((p: any, key: string) => { if (key === room2.sessionId) spawnX = p.x; });
  await new Promise((r) => setTimeout(r, 400));
  console.log(`[smoke] reconnect spawn x=${spawnX.toFixed(1)} (persisted ${movedX.toFixed(1)})`);
  await room2.leave();

  const ok = rejected && movedX > 0 && myLastSeq === seq && Math.abs(spawnX - movedX) < 1;
  console.log(`[smoke] result: ${ok ? "PASS" : "FAIL"}`);
  process.exit(ok ? 0 : 1);
}

void main();
