// pyxis/pixi-backend.ts — the Pixi RenderBackend: the ONLY Pixi-specific code. It owns the Pixi app + scene
// (follow-camera container, depth-sorted entity layer, fixed HUD) and the sprite-sheet loading/slicing, and draws
// whatever VisualSpec Pictor hands it — a box, or the requested sprite animation when loaded. All orchestration
// (diff, camera math, facing/anim selection) lives in @celestia/pictor; this file is just draw primitives.
import { AnimatedSprite, Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture, type Ticker } from "pixi.js";
import type { TilesetManifest, ZoneMapWire } from "@celestia/jupiter";
import { loadSpriteDescriptor, type RenderBackend, type VisualSpec } from "@celestia/pictor";

const LABEL_Z = 100000; // name tags + HP bars sort above every body
const ANIM_SPEED = 0.12;

type Sheet = { anims: Record<string, Texture[]> };
type Tiles = { tex: Texture; cols: number; px: number }; // loaded tilesheet: native cols + tile size (tileSize·S)
type Handle = { box: Graphics; label: Text; bar?: Graphics; sprite?: AnimatedSprite; curAnim?: string };

export class PixiBackend implements RenderBackend<Handle> {
  readonly app = new Application();
  readonly #bg = new Container();
  readonly #fg = new Container();
  readonly #worldC = new Container();
  #status!: Text;
  #pingText!: Text;
  #ground?: Container; // drawn map layer (tilesheet tiles, or debug boxes as fallback)
  #base = "";
  #scale = 1; // asset scale (1|2|3) chosen from the screen DPI → serve img/<scale> (BQ-style), draw at 1/scale
  #tileset?: TilesetManifest; // ground tileset manifest (tile value → sheet index)
  #tiles?: Tiles; // the loaded tilesheet (async); until then the ground falls back to debug boxes
  #map?: ZoneMapWire; // last map, re-drawn when the tilesheet finishes loading
  readonly #sheets = new Map<string, Sheet | null | "loading">(); // one per spriteId, shared across entities

  constructor(private readonly view: { width: number; height: number }) {}

  async init(): Promise<void> {
    const dpr = window.devicePixelRatio || 1;
    this.#scale = Math.min(3, Math.max(1, Math.round(dpr))); // match the DPI to the highest art we ship (img/3)
    // resolution+autoDensity give a DPI-backed canvas (crisp); nearest scaleMode (set per sheet) keeps pixel art sharp.
    await this.app.init({
      width: this.view.width,
      height: this.view.height,
      background: "#1a1a2e",
      antialias: true,
      resolution: dpr,
      autoDensity: true,
    });
    this.#fg.sortableChildren = true;
    this.#worldC.addChild(this.#bg, this.#fg);
    this.app.stage.addChild(this.#worldC);
    this.#status = new Text({ text: "logging in…", style: { fill: "#9ca3af", fontSize: 14 } });
    this.#status.position.set(8, 8);
    this.#pingText = new Text({ text: "", style: { fill: "#9ca3af", fontSize: 14 } });
    this.#pingText.anchor.set(1, 0);
    this.#pingText.position.set(this.view.width - 8, 8);
    this.app.stage.addChild(this.#status, this.#pingText); // HUD on the stage → screen-fixed
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }
  setStatus(text: string): void {
    this.#status.text = text;
  }
  setAssets(base: string, tileset?: TilesetManifest): void {
    this.#base = base;
    this.#tileset = tileset;
    if (tileset) void this.#loadTiles(tileset.id, tileset.tileSize);
  }
  camera(x: number, y: number, zoom: number): void {
    this.#worldC.scale.set(zoom); // zoom scales the whole world layer; the HUD lives on the stage, unscaled
    this.#worldC.position.set(x, y);
  }
  setHud(text: string): void {
    this.#pingText.text = text;
  }
  // Fill a new window size: resize the renderer (autoDensity keeps the DPI backing) + re-anchor the top-right HUD.
  resize(width: number, height: number): void {
    this.app.renderer.resize(width, height);
    this.#pingText.position.set(width - 8, 8);
  }
  // Per-frame loop (engine-specific — Pixi's ticker). `cb` gets a clamped dt; the caller runs control + render.
  onTick(cb: (dtSec: number) => void): void {
    this.app.ticker.add((t: Ticker) => cb(Math.min(0.05, t.deltaMS / 1000)));
  }

  setMap(m: ZoneMapWire): void {
    this.#map = m;
    this.#drawMap();
  }

  // Draw the ground + overlay. Per cell: a GROUND tile (explicit map.ground index, else the manifest value→index)
  // then an OVERLAY tile above it (map.overlay, 0 = none — buildings/props). No tilesheet yet → debug boxes.
  // Portals stay a cyan overlay. Entities (the #fg layer) always draw above this.
  #drawMap(): void {
    const m = this.#map;
    if (!m) return;
    this.#ground?.destroy({ children: true });
    const g = new Container(); // RAW world coords; the camera (worldC) centers/scrolls + zooms
    const t = this.#tiles;
    const ts = this.#tileset;
    const place = (idx: number, x: number, y: number): void => {
      const sp = this.#tileSprite(t!, idx);
      sp.position.set(x * m.tileSize, y * m.tileSize);
      sp.setSize(m.tileSize + 1, m.tileSize + 1); // +1 bleed overlaps the next cell → no seams at fractional zoom
      g.addChild(sp);
    };
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const gIdx = m.ground ? m.ground[y][x] : ts?.tiles[String(m.tiles[y][x])];
        if (t && gIdx) place(gIdx, x, y);
        else g.addChild(new Graphics().rect(x * m.tileSize, y * m.tileSize, m.tileSize - 1, m.tileSize - 1).fill(m.tiles[y][x] === 1 ? 0x4b3b2a : 0x242437));
        const oIdx = m.overlay?.[y]?.[x];
        if (t && oIdx) place(oIdx, x, y); // overlay drawn above the ground (added later = on top)
      }
    }
    for (const p of m.portals) {
      if (p.marker === false) continue; // portal opted out of the debug marker → render nothing (the trigger still fires server-side)
      g.addChild(
        new Graphics().rect(p.at.x * m.tileSize, p.at.y * m.tileSize, m.tileSize - 1, m.tileSize - 1).fill({ color: 0x22d3ee, alpha: 0.5 }),
      );
    }
    this.#bg.addChild(g);
    this.#ground = g;
  }

  // A Sprite for a 1-based tilesheet index (row-major), sliced from the loaded sheet.
  #tileSprite(t: Tiles, idx: number): Sprite {
    const col = (idx - 1) % t.cols;
    const row = Math.floor((idx - 1) / t.cols);
    return new Sprite(new Texture({ source: t.tex.source, frame: new Rectangle(col * t.px, row * t.px, t.px, t.px) }));
  }

  // Load the tilesheet (scale-aware, like sprite sheets); then redraw the map so the ground swaps boxes → tiles.
  async #loadTiles(id: string, tileSize: number): Promise<void> {
    const s = this.#scale;
    const tex = await Assets.load<Texture>(`${this.#base}/img/${s}/${id}.png`);
    tex.source.scaleMode = "nearest";
    this.#tiles = { tex, cols: Math.max(1, Math.floor(tex.source.width / (tileSize * s))), px: tileSize * s };
    this.#drawMap();
  }

  spawn(_id: string, spec: VisualSpec): Handle {
    const box = new Graphics();
    const label = new Text({ text: "", style: { fill: spec.label.color, fontSize: spec.kind === "player" ? 11 : 10 } });
    label.anchor.set(0.5, 1);
    const h: Handle = { box, label };
    this.#fg.addChild(box, label);
    if (spec.bar) {
      h.bar = new Graphics();
      this.#fg.addChild(h.bar);
    }
    this.update(h, spec);
    return h;
  }

  update(h: Handle, spec: VisualSpec): void {
    const b = spec.box;
    h.box.clear().rect(-b.size / 2, -b.size / 2, b.size, b.size).fill({ color: b.color, alpha: b.alpha });
    h.box.position.set(spec.x, spec.y);
    h.box.zIndex = spec.z;
    h.label.text = spec.label.text;
    h.label.alpha = b.alpha < 1 ? 0.4 : 1;
    h.label.position.set(spec.x, spec.y - 16);
    h.label.zIndex = LABEL_Z + spec.z;
    if (h.bar && spec.bar) {
      const w = b.size;
      const top = -b.size / 2 - 7;
      h.bar
        .clear()
        .rect(-w / 2, top, w, 3)
        .fill(0x3f3f46)
        .rect(-w / 2, top, w * spec.bar.frac, 3)
        .fill(spec.bar.alpha < 1 ? 0x6b7280 : 0x22c55e);
      h.bar.position.set(spec.x, spec.y);
      h.bar.zIndex = LABEL_Z + spec.z;
    }

    const sheet = spec.sprite ? this.#sheet(spec.sprite.id) : undefined;
    if (spec.useSprite && spec.sprite && sheet && sheet !== "loading") {
      const sp = spec.sprite; // narrowed: a loaded sheet + a requested anim
      if (!h.sprite) {
        h.sprite = new AnimatedSprite(frames(sheet, sp.anim));
        h.sprite.anchor.set(0.5, 0.85);
        h.sprite.animationSpeed = ANIM_SPEED;
        h.sprite.play();
        this.#fg.addChild(h.sprite);
      }
      if (h.curAnim !== sp.anim) {
        h.sprite.textures = frames(sheet, sp.anim);
        h.sprite.animationSpeed = ANIM_SPEED;
        h.sprite.play();
        h.curAnim = sp.anim;
      }
      const inv = 1 / this.#scale; // undo the Sx sheet so the sprite occupies base world units (just denser pixels)
      h.sprite.scale.set(sp.flip ? -inv : inv, inv);
      h.sprite.position.set(spec.x, spec.y);
      h.sprite.zIndex = spec.z;
      h.sprite.visible = true;
      h.box.visible = false;
    } else {
      if (h.sprite) h.sprite.visible = false;
      h.box.visible = true;
    }
  }

  despawn(h: Handle): void {
    h.box.destroy();
    h.label.destroy();
    h.bar?.destroy();
    h.sprite?.destroy();
  }

  // Lazily load + slice a sprite sheet (shared across entities of that id). Returns "loading" until ready.
  #sheet(id: string): Sheet | null | "loading" {
    const cur = this.#sheets.get(id);
    if (cur !== undefined) return cur;
    this.#sheets.set(id, "loading");
    void this.#load(id);
    return "loading";
  }
  async #load(id: string): Promise<void> {
    const d = await loadSpriteDescriptor(this.#base, id);
    if (!d) {
      this.#sheets.set(id, null);
      return;
    }
    const s = this.#scale; // the Sx sheet: every frame rect is S× the base frame size
    const tex = await Assets.load<Texture>(`${this.#base}/img/${s}/${id}.png`);
    tex.source.scaleMode = "nearest"; // crisp pixel art (no blur) when the camera/DPI scales it
    const anims: Record<string, Texture[]> = {};
    for (const [name, a] of Object.entries(d.animations)) {
      const list: Texture[] = [];
      for (let c = 0; c < a.length; c++) {
        list.push(
          new Texture({ source: tex.source, frame: new Rectangle(c * d.frameW * s, a.row * d.frameH * s, d.frameW * s, d.frameH * s) }),
        );
      }
      anims[name] = list;
    }
    this.#sheets.set(id, { anims });
  }
}

function frames(sheet: Sheet, anim: string): Texture[] {
  return sheet.anims[anim] ?? sheet.anims["idle_down"] ?? Object.values(sheet.anims)[0];
}
