// Pyxis — the bootstrap + input loop. Thin: login → enter → a Pictor Orchestrator driving a PixiBackend, plus a
// control loop (keyboard → World intents). The orchestration is shared (@celestia/pictor); the only Pixi-specific
// code is PixiBackend. The SDK's World (entities) is the model.
import { Jupiter, type World, type CredentialStore } from "@celestia/jupiter";
import { Orchestrator } from "@celestia/pictor";
import { PixiBackend } from "./pixi-backend.js";

const POLARIS_URL = (import.meta.env.VITE_POLARIS_URL as string) ?? "http://127.0.0.1:3000";
const ATLAS_URL = (import.meta.env.VITE_ATLAS_URL as string) ?? "ws://127.0.0.1:2567";
const VIEW = { width: window.innerWidth, height: window.innerHeight }; // fills the window; kept in sync on resize
const INTERACT_REACH = 48;
const ATTACK_REACH = 48;
const ATTACK_ANIM_MS = 400; // how long the local strike pose shows after an F press

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

async function main(): Promise<void> {
  const backend = new PixiBackend(VIEW);
  await backend.init();
  document.body.appendChild(backend.canvas);
  const orch = new Orchestrator(backend, VIEW);

  // Fill the window and follow resizes: update the shared VIEW (the orchestrator reads it each frame for the
  // camera clamp) + resize the renderer. Debounced to a rAF so a drag-resize doesn't thrash the renderer.
  let resizePending = false;
  window.addEventListener("resize", () => {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(() => {
      resizePending = false;
      VIEW.width = window.innerWidth;
      VIEW.height = window.innerHeight;
      backend.resize(VIEW.width, VIEW.height);
    });
  });

  // DOM keyboard → held keys + one-shot action flags (Pixi has no key manager).
  const held = new Set<string>();
  let interactQueued = false;
  let attackQueued = false;
  let attackUntil = 0; // local strike-pose window (wall-clock); drives the self entity's attack animation
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    held.add(k);
    if (k === "e") interactQueued = true;
    if (k === "f") attackQueued = true;
    if (k === "t") orch.toggleSprites(); // boxes (default) ↔ server-driven sprites
  });
  window.addEventListener("keyup", (e) => held.delete(e.key.toLowerCase()));
  const down = (...keys: string[]): boolean => keys.some((k) => held.has(k));

  const store = credentialStore();
  const jupiter = new Jupiter({ polarisUrl: POLARIS_URL, atlasUrl: ATLAS_URL });
  const session = await jupiter.loginSilent(store); // first run generates+caches a uid+password; later runs reuse it
  const world = await jupiter.enter(chooseName);
  const user = store.load()?.username ?? session.account.id.slice(0, 8);

  // Redraw the map + refresh the asset manifest on each zone (re)load; entity churn is handled by the frame diff.
  world.on("map", () => {
    if (world.map) orch.setScene(world.map, world.assets ?? undefined);
  });
  if (world.map) orch.setScene(world.map, world.assets ?? undefined); // in case the first map already arrived
  backend.setStatus(`${user} · WASD move · E=interact · F=attack · T=sprites`);

  // Control loop: input → intents → advance prediction/interp (world.tick), then project entities to the view.
  backend.onTick((dt) => {
    const dx = (down("a", "arrowleft") ? -1 : 0) + (down("d", "arrowright") ? 1 : 0);
    const dy = (down("w", "arrowup") ? -1 : 0) + (down("s", "arrowdown") ? 1 : 0);
    if (dx !== 0 || dy !== 0) world.input(dx, dy, dt);
    if (interactQueued) {
      interactQueued = false;
      const near = nearestLever(world);
      if (near) world.interact(near);
    }
    if (attackQueued) {
      attackQueued = false;
      attackUntil = performance.now() + ATTACK_ANIM_MS; // swing shows even if nothing's in reach
      const near = nearestMob(world);
      if (near) world.attack(near);
    }
    world.tick();
    // Local strike pose: the server doesn't sync the player's action, so flag the self entity for the window so
    // Pictor plays the attack animation (purely visual — the damage is server-authoritative, G1).
    if (performance.now() < attackUntil) world.entities.forEach((e) => e.self && (e.action = "attack"));
    orch.frame(
      world.entities,
      `${world.worldId}/${world.zoneId} · ${world.ping}ms · tick ${world.patchMs}ms · buf ${world.interpMs}ms`,
    );
  });
}

void main();
