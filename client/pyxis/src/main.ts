// Pyxis — a PixiJS renderer on @celestia/jupiter. PROOF the SDK is renderer-agnostic: this is the same shape as
// the Phaethon/Phaser client, with Pixi primitives instead and DOM keyboard instead of Phaser's input manager.
// It imports ONLY @celestia/jupiter + pixi.js — no colyseus, no transport, no netcode. Flow: Jupiter → login →
// enter → drive the World (input/interact/tick) + render self/players/levers/map. (Different demo user than
// Phaethon, so running both at once shows each as a remote in the other.)
import { Application, Container, Graphics, Text, type Ticker } from "pixi.js";
import { Jupiter, type World, type ZoneMapWire, type LeverView, type PlayerView } from "@celestia/jupiter";

const POLARIS_URL = (import.meta.env.VITE_POLARIS_URL as string) ?? "http://127.0.0.1:3000";
const ATLAS_URL = (import.meta.env.VITE_ATLAS_URL as string) ?? "ws://127.0.0.1:2567";
const DEMO_SECRET = (import.meta.env.VITE_BASIC_SECRET as string) ?? "change-me-dev";
const VIEW_W = 800, VIEW_H = 600, DT_MAX = 0.05, INTERACT_REACH = 48;

// Per-TAB account so you can open several tabs as different players — the server enforces one live session per
// account (it displaces the older one, close code 4409). `?user=NAME` pins an explicit account; otherwise each
// tab gets a stable random name kept in sessionStorage (survives reload of that tab, differs across tabs).
function resolveDemoUser(prefix: string): string {
  const fromUrl = new URLSearchParams(location.search).get("user");
  if (fromUrl) return fromUrl;
  const envUser = import.meta.env.VITE_DEMO_USER as string | undefined;
  if (envUser) return envUser;
  const existing = sessionStorage.getItem("celestia:demo-user");
  if (existing) return existing;
  const generated = `${prefix}-${Math.random().toString(36).slice(2, 6)}`;
  sessionStorage.setItem("celestia:demo-user", generated);
  return generated;
}

type Remote = { g: Graphics; label: Text };

function nearestLever(w: World): string | undefined {
  let best: string | undefined;
  let bestD = INTERACT_REACH;
  w.levers.forEach((l, id) => {
    const d = Math.hypot(l.x - w.self.x, l.y - w.self.y);
    if (d <= bestD) {
      bestD = d;
      best = id;
    }
  });
  return best;
}

async function main(): Promise<void> {
  const app = new Application();
  await app.init({ width: VIEW_W, height: VIEW_H, background: "#1a1a2e", antialias: true });
  document.body.appendChild(app.canvas);

  const bg = new Container();
  const fg = new Container();
  app.stage.addChild(bg, fg);
  const status = new Text({ text: "logging in…", style: { fill: "#9ca3af", fontSize: 14 } });
  status.position.set(8, 8);
  app.stage.addChild(status);
  const pingText = new Text({ text: "", style: { fill: "#9ca3af", fontSize: 14 } });
  pingText.anchor.set(1, 0); // top-right
  pingText.position.set(VIEW_W - 8, 8);
  app.stage.addChild(pingText);

  // Pixi has no key manager — wire DOM events ourselves (the one bit of extra boilerplate vs Phaser).
  const held = new Set<string>();
  let interactQueued = false;
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    held.add(k);
    if (k === "e") interactQueued = true;
  });
  window.addEventListener("keyup", (e) => held.delete(e.key.toLowerCase()));
  const down = (...keys: string[]): boolean => keys.some((k) => held.has(k));

  let offX = VIEW_W / 2;
  let offY = VIEW_H / 2;
  let mapGfx: Graphics | undefined;
  const remotes = new Map<string, Remote>();
  const leverGfx = new Map<string, Graphics>();

  const selfGfx = new Graphics().rect(-12, -12, 24, 24).fill(0x4ade80);
  const selfLabel = new Text({ text: "you", style: { fill: "#4ade80", fontSize: 11 } });
  selfLabel.anchor.set(0.5, 1);
  fg.addChild(selfGfx, selfLabel);

  const user = resolveDemoUser("trinity");
  const jupiter = new Jupiter({ polarisUrl: POLARIS_URL, atlasUrl: ATLAS_URL });
  await jupiter.login(user, DEMO_SECRET);
  const world = await jupiter.enter();
  status.text = `${user} · green=you · blue=others · E=interact`;

  const drawMap = (m: ZoneMapWire): void => {
    offX = Math.round((VIEW_W - m.width * m.tileSize) / 2);
    offY = Math.round((VIEW_H - m.height * m.tileSize) / 2);
    mapGfx?.destroy();
    const g = new Graphics();
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        g.rect(x * m.tileSize + offX, y * m.tileSize + offY, m.tileSize - 1, m.tileSize - 1).fill(
          m.tiles[y][x] === 1 ? 0x4b3b2a : 0x242437,
        );
      }
    }
    for (const p of m.portals) {
      g.rect(p.at.x * m.tileSize + offX, p.at.y * m.tileSize + offY, m.tileSize - 1, m.tileSize - 1).fill({
        color: 0x22d3ee,
        alpha: 0.5,
      });
    }
    bg.addChild(g);
    mapGfx = g;
  };

  const reset = (): void => {
    remotes.forEach((r) => {
      r.g.destroy();
      r.label.destroy();
    });
    remotes.clear();
    leverGfx.forEach((g) => g.destroy());
    leverGfx.clear();
    mapGfx?.destroy();
    mapGfx = undefined;
  };

  world.on("map", (m: ZoneMapWire) => drawMap(m));
  world.on("playerAdd", (id: string, p: PlayerView) => {
    const g = new Graphics().rect(-12, -12, 24, 24).fill(0x60a5fa);
    const label = new Text({ text: p.name || "…", style: { fill: "#60a5fa", fontSize: 11 } });
    label.anchor.set(0.5, 1);
    fg.addChild(g, label);
    remotes.set(id, { g, label });
  });
  world.on("playerRemove", (id: string) => {
    const r = remotes.get(id);
    r?.g.destroy();
    r?.label.destroy();
    remotes.delete(id);
  });
  world.on("leverAdd", (id: string, l: LeverView) => {
    const g = new Graphics().rect(-7, -7, 14, 14).fill(l.on ? 0xfbbf24 : 0x6b7280);
    fg.addChild(g);
    leverGfx.set(id, g);
  });
  world.on("leverChange", (id: string, l: LeverView) => {
    leverGfx.get(id)?.clear().rect(-7, -7, 14, 14).fill(l.on ? 0xfbbf24 : 0x6b7280);
  });
  world.on("leverRemove", (id: string) => {
    leverGfx.get(id)?.destroy();
    leverGfx.delete(id);
  });
  world.on("zoneChange", () => reset()); // world/zone label is driven per-frame from the HUD below

  app.ticker.add((ticker: Ticker) => {
    const dt = Math.min(DT_MAX, ticker.deltaMS / 1000);
    const dx = (down("a", "arrowleft") ? -1 : 0) + (down("d", "arrowright") ? 1 : 0);
    const dy = (down("w", "arrowup") ? -1 : 0) + (down("s", "arrowdown") ? 1 : 0);
    if (dx !== 0 || dy !== 0) world.input(dx, dy, dt);
    if (interactQueued) {
      interactQueued = false;
      const near = nearestLever(world);
      if (near) world.interact(near);
    }
    world.tick();

    selfGfx.position.set(world.self.x + offX, world.self.y + offY);
    selfLabel.position.set(world.self.x + offX, world.self.y + offY - 16);
    remotes.forEach((r, id) => {
      const p = world.players.get(id);
      if (!p) return;
      r.g.position.set(p.x + offX, p.y + offY);
      r.label.position.set(p.x + offX, p.y + offY - 16);
    });
    leverGfx.forEach((g, id) => {
      const l = world.levers.get(id);
      if (l) g.position.set(l.x + offX, l.y + offY);
    });
    pingText.text = `${world.worldId}/${world.zoneId} · ${world.ping}ms · tick ${world.patchMs}ms · buf ${world.interpMs}ms`;
  });
}

void main();
