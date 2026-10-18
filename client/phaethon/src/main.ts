// Celestia netcode POC — Vite + Phaser on top of @celestia/jupiter (the client SDK).
// This file is now ONLY a renderer: it reads the SDK's World (plain data + events) and draws it with Phaser.
// It imports NO colyseus, no transport, no netcode — the SDK owns all of that (docs/CLIENT-SDK.md §1). Swapping
// Phaser for React/vanilla/Godot-web means rewriting only this file; the SDK is unchanged. Flow: Jupiter →
// login → enter → drive the returned World (input/interact/tick) + render from world.self/players/levers/map.
import Phaser from "phaser";
import { Jupiter, type World, type LeverView, type PlayerView, type ZoneMapWire } from "@celestia/jupiter";

const POLARIS_URL = (import.meta.env.VITE_POLARIS_URL as string) ?? "http://127.0.0.1:3000";
const ATLAS_URL = (import.meta.env.VITE_ATLAS_URL as string) ?? "ws://127.0.0.1:2567";
const DEMO_SECRET = (import.meta.env.VITE_BASIC_SECRET as string) ?? "change-me-dev";
const VIEW_W = 800, VIEW_H = 600;
const DT_MAX = 0.05;
const INTERACT_REACH = 48;

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

type Sprite = { rect: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text };

class ZoneScene extends Phaser.Scene {
  private world?: World;
  private readonly remotes = new Map<string, Sprite>();
  private readonly leverRects = new Map<string, Phaser.GameObjects.Rectangle>();
  private mapGfx?: Phaser.GameObjects.Graphics;
  private offX = VIEW_W / 2;
  private offY = VIEW_H / 2;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private status!: Phaser.GameObjects.Text;
  private pingText!: Phaser.GameObjects.Text;
  private selfRect?: Phaser.GameObjects.Rectangle;
  private selfLabel?: Phaser.GameObjects.Text;

  constructor() { super("zone"); }

  create() {
    this.status = this.add.text(8, 8, "logging in…", { color: "#9ca3af", fontSize: "14px" });
    this.pingText = this.add.text(VIEW_W - 8, 8, "", { color: "#9ca3af", fontSize: "14px" }).setOrigin(1, 0);
    this.keys = this.input.keyboard!.addKeys("W,A,S,D,UP,LEFT,DOWN,RIGHT,E") as Record<string, Phaser.Input.Keyboard.Key>;
    void this.connect();
  }

  private async connect() {
    const user = resolveDemoUser("neo");
    const jupiter = new Jupiter({ polarisUrl: POLARIS_URL, atlasUrl: ATLAS_URL });
    await jupiter.login(user, DEMO_SECRET);
    const world = await jupiter.enter();
    this.world = world;
    this.status.setText(`${user} · green=you · blue=others · E=interact`);
    this.selfRect = this.add.rectangle(0, 0, 24, 24, 0x4ade80);
    this.selfLabel = this.add.text(0, 0, "you", { color: "#4ade80", fontSize: "11px" }).setOrigin(0.5, 1);

    world.on("map", (map: ZoneMapWire) => this.drawMap(map));
    world.on("playerAdd", (id: string, p: PlayerView) => this.remotes.set(id, this.makeSprite(p.name)));
    world.on("playerRemove", (id: string) => {
      const s = this.remotes.get(id);
      s?.rect.destroy();
      s?.label.destroy();
      this.remotes.delete(id);
    });
    world.on("leverAdd", (id: string, l: LeverView) =>
      this.leverRects.set(id, this.add.rectangle(0, 0, 14, 14, l.on ? 0xfbbf24 : 0x6b7280)),
    );
    world.on("leverChange", (id: string, l: LeverView) =>
      this.leverRects.get(id)?.setFillStyle(l.on ? 0xfbbf24 : 0x6b7280),
    );
    world.on("leverRemove", (id: string) => {
      this.leverRects.get(id)?.destroy();
      this.leverRects.delete(id);
    });
    world.on("zoneChange", () => this.resetGraphics()); // world/zone label is driven per-frame in update()
  }

  private makeSprite(name: string): Sprite {
    return {
      rect: this.add.rectangle(0, 0, 24, 24, 0x60a5fa),
      label: this.add.text(0, 0, name || "…", { color: "#60a5fa", fontSize: "11px" }).setOrigin(0.5, 1),
    };
  }

  private drawMap(map: ZoneMapWire): void {
    const { width, height, tileSize, tiles, portals } = map;
    this.offX = Math.round((VIEW_W - width * tileSize) / 2);
    this.offY = Math.round((VIEW_H - height * tileSize) / 2);
    this.mapGfx?.destroy();
    const g = this.add.graphics();
    g.setDepth(-10);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        g.fillStyle(tiles[y][x] === 1 ? 0x4b3b2a : 0x242437, 1); // box : floor
        g.fillRect(x * tileSize + this.offX, y * tileSize + this.offY, tileSize - 1, tileSize - 1);
      }
    }
    for (const p of portals) {
      g.fillStyle(0x22d3ee, 0.5);
      g.fillRect(p.at.x * tileSize + this.offX, p.at.y * tileSize + this.offY, tileSize - 1, tileSize - 1);
    }
    this.mapGfx = g;
  }

  private resetGraphics(): void {
    this.remotes.forEach((s) => {
      s.rect.destroy();
      s.label.destroy();
    });
    this.remotes.clear();
    this.leverRects.forEach((r) => r.destroy());
    this.leverRects.clear();
    this.mapGfx?.destroy();
    this.mapGfx = undefined;
  }

  update(_t: number, deltaMs: number): void {
    const w = this.world;
    if (!w) return;
    const dt = Math.min(DT_MAX, deltaMs / 1000);
    const dx = (this.held("A", "LEFT") ? -1 : 0) + (this.held("D", "RIGHT") ? 1 : 0);
    const dy = (this.held("W", "UP") ? -1 : 0) + (this.held("S", "DOWN") ? 1 : 0);
    if (dx !== 0 || dy !== 0) w.input(dx, dy, dt);
    if (Phaser.Input.Keyboard.JustDown(this.keys.E)) {
      const near = this.nearestLever(w);
      if (near) w.interact(near);
    }
    w.tick(); // advance prediction + interpolation
    this.pingText.setText(`${w.worldId}/${w.zoneId} · ${w.ping}ms · tick ${w.patchMs}ms · buf ${w.interpMs}ms`);

    if (this.selfRect) { this.selfRect.x = w.self.x + this.offX; this.selfRect.y = w.self.y + this.offY; }
    if (this.selfLabel) { this.selfLabel.x = w.self.x + this.offX; this.selfLabel.y = w.self.y + this.offY - 16; }
    this.remotes.forEach((s, id) => {
      const p = w.players.get(id);
      if (!p) return;
      s.rect.x = p.x + this.offX;
      s.rect.y = p.y + this.offY;
      s.label.x = p.x + this.offX;
      s.label.y = p.y + this.offY - 16;
    });
    this.leverRects.forEach((rect, id) => {
      const l = w.levers.get(id);
      if (l) {
        rect.x = l.x + this.offX;
        rect.y = l.y + this.offY;
      }
    });
  }

  private nearestLever(w: World): string | undefined {
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

  private held(...names: string[]): boolean {
    return names.some((n) => this.keys[n]?.isDown);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: VIEW_W,
  height: VIEW_H,
  backgroundColor: "#1a1a2e",
  scene: ZoneScene,
});
