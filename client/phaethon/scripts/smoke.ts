// Headless e2e (no browser): drive the SDK exactly as a game would — login → enter → move → persist across a
// reconnect. Uses ONLY @celestia/jupiter (no colyseus, no transport details). Start the stack first
// (pnpm gaia:up, migrate, polaris, atlas):  pnpm -C client/phaethon run smoke
import { Jupiter, type World } from "@celestia/jupiter";

const POLARIS = process.env.POLARIS_URL ?? "http://127.0.0.1:3000";
const ATLAS = process.env.ATLAS_URL ?? "ws://127.0.0.1:2567";
const SECRET = process.env.BASIC_SECRET ?? "change-me-dev";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function enter(): Promise<World> {
  const jupiter = new Jupiter({ polarisUrl: POLARIS, atlasUrl: ATLAS });
  await jupiter.login("smoke", SECRET);
  const world = await jupiter.enter(() => `Smoke_${Math.random().toString(36).slice(2, 7)}`);
  await sleep(300);
  world.tick();
  return world;
}

async function main(): Promise<void> {
  // 1) enter + move right (server-reconciled position is read via world.self after tick()).
  const world = await enter();
  console.log(`[smoke] entered zone=${world.zoneId}`);
  for (let i = 0; i < 6; i++) {
    world.input(1, 0, 0.05);
    await sleep(60);
    world.tick();
  }
  await sleep(250);
  world.tick();
  const movedX = world.self.x;
  console.log(`[smoke] moved x=${movedX.toFixed(1)}`);
  world.leave(); // triggers the write-behind placement save
  await sleep(600);

  // 2) reconnect -> resumes at the PERSISTED position (continuity via saved placement).
  const world2 = await enter();
  await sleep(300);
  world2.tick();
  const spawnX = world2.self.x;
  console.log(`[smoke] reconnect spawn x=${spawnX.toFixed(1)} (persisted ${movedX.toFixed(1)})`);
  world2.leave();

  const ok = movedX > 0 && Math.abs(spawnX - movedX) < 1;
  console.log(`[smoke] result: ${ok ? "PASS" : "FAIL"}`);
  process.exit(ok ? 0 : 1);
}

void main();
