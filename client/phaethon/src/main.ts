// Phaethon — the Phaser web client on @celestia/jupiter. Thin: a scene that wires a Pictor Orchestrator to a
// PhaserBackend and runs the control loop (keyboard → World intents). All render orchestration is SHARED
// (@celestia/pictor — id-diff, camera, facing/anim, VisualSpec); the only Phaser-specific code is PhaserBackend.
// Sibling pyxis is the same shape over Pixi — together they prove the SDK + Pictor are renderer-agnostic. This
// imports NO colyseus/transport/netcode — the SDK owns all of that (docs/CLIENT-SDK.md §1).
import Phaser from "phaser";
import { Jupiter, type World, type CredentialStore } from "@celestia/jupiter";
import { Orchestrator } from "@celestia/pictor";
import { PhaserBackend } from "./phaser-backend.js";

const POLARIS_URL = (import.meta.env.VITE_POLARIS_URL as string) ?? "http://127.0.0.1:3000";
const ATLAS_URL = (import.meta.env.VITE_ATLAS_URL as string) ?? "ws://127.0.0.1:2567";
const VIEW = { width: window.innerWidth, height: window.innerHeight }; // fills the window; kept in sync on resize
const DT_MAX = 0.05;
const INTERACT_REACH = 48;
const ATTACK_REACH = 48;
const ATTACK_ANIM_MS = 400; // how long the local strike pose shows after an F press

type Handle = ReturnType<PhaserBackend["spawn"]>; // the backend's opaque per-entity view handle

// Silent account (BrowserQuest-style): a per-browser uid+password generated on first run and cached in
// localStorage, so it survives reload/restart (device-bound — clearing storage loses the character). The SDK
// owns generate/cache/auto-login; this is just the web storage adapter. `?user=NAME` namespaces a SEPARATE
// cached credential so several tabs can be distinct accounts for multiplayer testing (the server enforces one
// live session per account, close code 4409); no param = one account per browser.
function credentialStore(): CredentialStore {
  const ns = new URLSearchParams(location.search).get("user");
  const key = ns ? `celestia:cred:${ns}` : "celestia:cred";
  return {
    load() {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      try {
        const c = JSON.parse(raw) as { username?: unknown; password?: unknown };
        return typeof c.username === "string" && typeof c.password === "string" ? { username: c.username, password: c.password } : null;
      } catch {
        return null;
      }
    },
    save(c) {
      localStorage.setItem(key, JSON.stringify(c));
    },
  };
}

// Character name — enter() calls this ONLY when the account has no character yet (first run). A blank/cancelled
// prompt falls back to a generated hero name so the flow never blocks.
function chooseName(): string {
  const entered = (typeof window !== "undefined" ? window.prompt("Name your character:") : null)?.trim();
  return entered && entered.length > 0 ? entered : `Hero-${Math.random().toString(36).slice(2, 6)}`;
}

// Targeting over the unified entity store: nearest in-reach lever / living mob. The server re-validates reach +
// computes outcomes; this only picks a candidate id (G1).
function nearestLever(w: World): string | undefined {
  let best: string | undefined;
  let bestD = INTERACT_REACH;
  w.entities.forEach((e, id) => {
    if (e.kind !== "lever") return;
    const d = Math.hypot(e.x - w.self.x, e.y - w.self.y);
    if (d <= bestD) {
      bestD = d;
      best = id;
    }
  });
  return best;
}

function nearestMob(w: World): string | undefined {
  let best: string | undefined;
  let bestD = ATTACK_REACH;
  w.entities.forEach((e, id) => {
    if (e.kind === "player" || e.kind === "lever") return; // mobs = anything else
    if ((e.hp ?? 0) <= 0) return; // can't attack a corpse
    const d = Math.hypot(e.x - w.self.x, e.y - w.self.y);
    if (d <= bestD) {
      bestD = d;
      best = id;
    }
  });
  return best;
}

class ZoneScene extends Phaser.Scene {
  #world?: World;
  #backend!: PhaserBackend;
  #orch!: Orchestrator<Handle>;
  #keys!: Record<string, Phaser.Input.Keyboard.Key>;
  #attackUntil = 0; // local strike-pose window (wall-clock); drives the self entity's attack animation

  constructor() {
    super("zone");
  }

  create(): void {
    this.#backend = new PhaserBackend(this, VIEW);
    void this.#backend.init();
    this.#orch = new Orchestrator(this.#backend, VIEW);
    this.#keys = this.input.keyboard!.addKeys("W,A,S,D,UP,LEFT,DOWN,RIGHT,E,F,T") as Record<string, Phaser.Input.Keyboard.Key>;
    // Fill the window: keep the shared VIEW in sync (orchestrator reads it for the camera clamp) + resize the HUD.
    this.scale.on("resize", (size: Phaser.Structs.Size) => {
      VIEW.width = size.width;
      VIEW.height = size.height;
      this.#backend.resize(size.width, size.height);
    });
    void this.#connect();
  }

  async #connect(): Promise<void> {
    const store = credentialStore();
    const jupiter = new Jupiter({ polarisUrl: POLARIS_URL, atlasUrl: ATLAS_URL });
    const session = await jupiter.loginSilent(store); // first run generates+caches a uid+password; later runs reuse it
    const world = await jupiter.enter(chooseName);
    const user = store.load()?.username ?? session.account.id.slice(0, 8);
    this.#world = world;
    // Redraw the map + refresh the asset manifest on each zone (re)load; entity churn rides the frame diff.
    world.on("map", () => {
      if (world.map) this.#orch.setScene(world.map, world.assets ?? undefined);
    });
    if (world.map) this.#orch.setScene(world.map, world.assets ?? undefined);
    this.#backend.setStatus(`${user} · WASD move · E=interact · F=attack · T=sprites`);
  }

  update(_t: number, deltaMs: number): void {
    const w = this.#world;
    if (!w) return;
    const dt = Math.min(DT_MAX, deltaMs / 1000);
    const dx = (this.#held("A", "LEFT") ? -1 : 0) + (this.#held("D", "RIGHT") ? 1 : 0);
    const dy = (this.#held("W", "UP") ? -1 : 0) + (this.#held("S", "DOWN") ? 1 : 0);
    if (dx !== 0 || dy !== 0) w.input(dx, dy, dt);
    if (Phaser.Input.Keyboard.JustDown(this.#keys.E)) {
      const near = nearestLever(w);
      if (near) w.interact(near);
    }
    if (Phaser.Input.Keyboard.JustDown(this.#keys.F)) {
      this.#attackUntil = performance.now() + ATTACK_ANIM_MS; // swing shows even if nothing's in reach
      const near = nearestMob(w);
      if (near) w.attack(near);
    }
    if (Phaser.Input.Keyboard.JustDown(this.#keys.T)) this.#orch.toggleSprites(); // boxes (default) ↔ sprites
    w.tick(); // advance prediction + interpolation
    // Local strike pose: the server doesn't sync the player's action, so flag the self entity for the window so
    // Pictor plays the attack animation (purely visual — the damage is server-authoritative, G1).
    if (performance.now() < this.#attackUntil) w.entities.forEach((e) => e.self && (e.action = "attack"));
    this.#orch.frame(w.entities, `${w.worldId}/${w.zoneId} · ${w.ping}ms · tick ${w.patchMs}ms · buf ${w.interpMs}ms`);
  }

  #held(...names: string[]): boolean {
    return names.some((n) => this.#keys[n]?.isDown);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  backgroundColor: "#1a1a2e",
  pixelArt: true, // nearest-neighbor: crisp pixel art (matches the backend's Sx asset scaling)
  scale: { mode: Phaser.Scale.RESIZE, width: VIEW.width, height: VIEW.height }, // fill the window, follow resizes
  scene: ZoneScene,
});
