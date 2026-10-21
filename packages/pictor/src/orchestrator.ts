// pictor/orchestrator.ts — the shared render logic. Projects the Jupiter World's `entities` (component data) onto
// a RenderBackend each frame: id-diff (spawn/update/despawn), follow-camera, HUD, and the per-entity VisualSpec
// (box appearance + label + HP bar + which sprite/animation + facing). Pure TS, no engine types — pyxis, phaethon,
// and a future Godot backend all share THIS; they differ only in their RenderBackend. Render bookkeeping
// (facing/prev-position) is held as DATA here, keyed by id — never on the view objects.
import type { AssetManifest, Entity, ZoneMapWire } from "@celestia/jupiter";
import type { Facing, RenderBackend, VisualSpec } from "./backend.js";

const MOVE_EPS = 0.3; // px/frame above which an entity counts as "moving" (→ walk anim + re-face)
// Fixed camera zoom (world→screen scale). The CELL size is constant and a tile always fills one cell, so a
// building's on-screen size is just (footprint × cell × ZOOM) — it does NOT depend on map size. This is the one
// knob for "how big everything looks"; the map only decides how much world exists. Integer → crisp, seam-free.
const ZOOM = 2;

// Debug-box palette by kind (the FALLBACK look; real art comes from the manifest sprites). Unknown mob kind →
// a generic purple box, so a new kind renders with zero code.
const MOB_BOX: Record<string, { color: number; size: number }> = {
  rat: { color: 0xf87171, size: 16 },
  skeleton: { color: 0xe5e7eb, size: 22 },
};

function boxStyle(e: Entity): { color: number; size: number; alpha: number } {
  if (e.kind === "lever") return { color: e.on ? 0xfbbf24 : 0x6b7280, size: 14, alpha: 1 };
  if (e.kind === "player") return { color: e.self ? 0x4ade80 : 0x60a5fa, size: 24, alpha: 1 };
  const s = MOB_BOX[e.kind] ?? { color: 0xa78bfa, size: 18 };
  return { color: s.color, size: s.size, alpha: (e.hp ?? 1) <= 0 ? 0.2 : 1 };
}
const labelColor = (e: Entity): string => (e.self ? "#4ade80" : e.kind === "player" ? "#60a5fa" : "#e5e7eb");
function labelText(e: Entity): string {
  if (e.self) return `you ${Math.max(0, e.hp ?? 0)}/${e.maxHp ?? 0}`;
  if (e.kind === "player") return e.name ?? "…";
  if (e.kind === "lever") return "";
  const tag = e.action && e.action !== "idle" ? ` · ${e.action}` : "";
  return `${e.kind} ${Math.max(0, e.hp ?? 0)}/${e.maxHp ?? 0}${tag}`;
}
const hasBar = (e: Entity): boolean => e.hp != null && e.kind !== "player" && e.kind !== "lever"; // mobs show HP

// Follow-camera on one axis, in SCREEN pixels, at scale `zoom`: center `pos`, clamped to the map edges; center a
// (zoomed) map smaller than the view. `mapSize`/`pos` are world units; multiply by zoom to get screen pixels.
function cam(pos: number, mapSize: number, view: number, zoom: number): number {
  const mapPx = mapSize * zoom;
  if (mapPx <= view) return Math.round((view - mapPx) / 2);
  return Math.round(Math.min(0, Math.max(view - mapPx, view / 2 - pos * zoom)));
}

type RState = { prevX: number; prevY: number; facing: Facing };

export class Orchestrator<H> {
  readonly #views = new Map<string, { h: H; r: RState }>();
  #kinds: Record<string, string> = {};
  #spriteMode = false;
  #mapW = 0;
  #mapH = 0;

  constructor(
    private readonly backend: RenderBackend<H>,
    private readonly view: { width: number; height: number },
  ) {}

  setScene(map: ZoneMapWire, assets?: AssetManifest): void {
    this.#mapW = map.width * map.tileSize;
    this.#mapH = map.height * map.tileSize;
    // setAssets BEFORE setMap: the backend needs the tileset to draw the ground when the map arrives.
    if (assets) {
      this.#kinds = assets.kinds;
      this.backend.setAssets(assets.base, assets.tileset);
    }
    this.backend.setMap(map);
  }
  toggleSprites(): void {
    this.#spriteMode = !this.#spriteMode;
  }

  // Camera zoom is a FIXED constant (not derived from map/screen) — so a building looks the same size regardless
  // of how big the map is. The camera still follows the player + clamps to the map edges at this scale.
  #zoom(): number {
    return ZOOM;
  }

  /** Project the entity store onto the backend: camera (self), despawn gone, spawn new, update all. */
  frame(entities: ReadonlyMap<string, Entity>, hud: string): void {
    let self: Entity | undefined;
    entities.forEach((e) => {
      if (e.self) self = e;
    });
    const zoom = this.#zoom();
    if (self) {
      this.backend.camera(cam(self.x, this.#mapW, this.view.width, zoom), cam(self.y, this.#mapH, this.view.height, zoom), zoom);
    }

    for (const id of [...this.#views.keys()]) {
      if (!entities.has(id)) {
        this.backend.despawn(this.#views.get(id)!.h);
        this.#views.delete(id);
      }
    }
    entities.forEach((e, id) => {
      const existing = this.#views.get(id);
      const r = existing?.r ?? { prevX: e.x, prevY: e.y, facing: "down" as Facing };
      const spec = this.#spec(e, r);
      if (existing) this.backend.update(existing.h, spec);
      else this.#views.set(id, { h: this.backend.spawn(id, spec), r });
    });

    this.backend.setHud(`${hud} · ${this.#spriteMode ? "sprites" : "boxes"}`);
  }

  // Attack-pose policy by actor: a PLAYER's "attack" is a deliberate, brief strike (the client sets it on input)
  // → always show it, even mid-stride. A MOB's "attack" is a sustained TACTIC while it closes distance → let
  // locomotion win (a chasing mob walks; the strike pose shows only in range + stationary), so it doesn't "swing
  // while walking." Both otherwise walk when moving, idle when still.
  #anim(kind: string, striking: boolean, moved: boolean): "atk" | "walk" | "idle" {
    if (kind === "player" && striking) return "atk";
    if (moved) return "walk";
    if (striking) return "atk";
    return "idle";
  }

  // Entity data → VisualSpec, updating the entity's facing from movement (held here as data, not on the view).
  #spec(e: Entity, r: RState): VisualSpec {
    const dx = e.x - r.prevX;
    const dy = e.y - r.prevY;
    const moved = Math.abs(dx) > MOVE_EPS || Math.abs(dy) > MOVE_EPS;
    if (moved) r.facing = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down";
    r.prevX = e.x;
    r.prevY = e.y;

    const dead = (e.hp ?? 1) <= 0;
    const act = this.#anim(e.kind, e.action === "attack", moved);
    const sid = this.#kinds[e.kind];
    const spec: VisualSpec = {
      kind: e.kind,
      x: e.x,
      y: e.y,
      z: e.y,
      box: boxStyle(e),
      label: { text: labelText(e), color: labelColor(e) },
      useSprite: this.#spriteMode && !!sid && !dead, // dead → dimmed box even in sprite mode
    };
    if (hasBar(e)) {
      const frac = (e.maxHp ?? 0) > 0 ? Math.max(0, Math.min(1, (e.hp ?? 0) / (e.maxHp ?? 1))) : 0;
      spec.bar = { frac, alpha: dead ? 0.6 : 1 };
    }
    if (sid) spec.sprite = { id: sid, anim: `${act}_${r.facing === "left" ? "right" : r.facing}`, flip: r.facing === "left" };
    return spec;
  }
}
