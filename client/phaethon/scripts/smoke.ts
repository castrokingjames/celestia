// Headless e2e (no browser): the full badge-first path. login -> one access badge -> ONE Atlas connection ->
// Janus lobby -> create/select a character -> play.enter -> consume the seat reservation -> the zone room ->
// move -> position advances AND PERSISTS across a reconnect (placement write-behind). Also: a DIRECT zone join
// (no reservation) is rejected by onAuth. Start the stack first (pnpm gaia:up, migrate, polaris, atlas):
//   pnpm -C client/phaethon run smoke
import { Client, getStateCallbacks, type Room } from "colyseus.js";
import { type InputCommand } from "@celestia/norma";
import { login, Lobby, type PlayEnterResult } from "../src/sdk/session.js";

const POLARIS = process.env.POLARIS_URL ?? "http://127.0.0.1:3000";
const ATLAS = process.env.ATLAS_URL ?? "ws://127.0.0.1:2567";
const SECRET = process.env.BASIC_SECRET ?? "change-me-dev";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** login -> badge -> lobby -> ensure a character -> play.enter -> consume the reservation -> the zone room. */
async function enterWorld(client: Client): Promise<{ room: Room; enter: PlayEnterResult }> {
  const { accessBadge } = await login(POLARIS, "smoke", SECRET);
  const lobby = await Lobby.open(client, accessBadge);
  const enter = await new Promise<PlayEnterResult>((resolve) => {
    lobby.onState((state) => {
      if (state.characters.length === 0) lobby.create(`Smoke_${Math.random().toString(36).slice(2, 7)}`);
      else void lobby.enter(state.characters[0].id).then(resolve);
    });
  });
  lobby.leave();
  const room = await client.consumeSeatReservation(
    enter.seatReservation as unknown as Parameters<Client["consumeSeatReservation"]>[0],
  );
  return { room, enter };
}

async function main(): Promise<void> {
  const client = new Client(ATLAS);

  // 1) a direct zone join (no seat reservation) must be rejected by onAuth.
  let rejected = false;
  try {
    const bad = await client.joinOrCreate("zone", {});
    await bad.leave();
  } catch {
    rejected = true;
  }
  console.log(`[smoke] direct zone join rejected: ${rejected}`);

  // 2) proper entry + move.
  const { room, enter } = await enterWorld(client);
  console.log(`[smoke] entered zone=${enter.zoneId}`);
  const id = room.sessionId;
  let myX = 0;
  let myLastSeq = 0;
  const $ = getStateCallbacks(room);
  $(room.state).players.onAdd((p: any, key: string) => {
    if (key === id) $(p).onChange(() => { myX = p.x; myLastSeq = p.lastSeq; });
  });
  await sleep(300);
  let seq = 0;
  for (let i = 0; i < 6; i++) {
    room.send("input", { seq: ++seq, dx: 1, dy: 0, dt: 0.05 } as InputCommand);
    await sleep(60);
  }
  await sleep(200);
  const movedX = myX;
  console.log(`[smoke] moved x=${movedX.toFixed(1)} lastSeq=${myLastSeq}/${seq}`);
  await room.leave(); // triggers the write-behind placement save
  await sleep(600);

  // 3) reconnect -> resumes at the PERSISTED position (continuity via saved placement).
  const { room: room2 } = await enterWorld(client);
  let spawnX = 0;
  const $2 = getStateCallbacks(room2);
  $2(room2.state).players.onAdd((p: any, key: string) => {
    if (key === room2.sessionId) spawnX = p.x;
  });
  await sleep(400);
  console.log(`[smoke] reconnect spawn x=${spawnX.toFixed(1)} (persisted ${movedX.toFixed(1)})`);
  await room2.leave();

  const ok = rejected && movedX > 0 && myLastSeq === seq && Math.abs(spawnX - movedX) < 1;
  console.log(`[smoke] result: ${ok ? "PASS" : "FAIL"}`);
  process.exit(ok ? 0 : 1);
}

void main();
