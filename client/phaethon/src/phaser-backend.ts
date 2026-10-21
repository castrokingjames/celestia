// phaethon/phaser-backend.ts — the Phaser RenderBackend: the ONLY Phaser-specific code. It draws whatever
// VisualSpec Pictor hands it onto a Phaser scene (a box by default, or the requested sprite animation once the
// sheet is loaded), owns the follow-camera (the scene camera's scroll) + the screen-fixed HUD, and loads/slices
// sprite sheets into Phaser animations. All orchestration (diff, camera math, facing/anim selection) lives in
// @celestia/pictor; sibling pyxis has a PixiBackend over the SAME contract — they differ only in these draw calls.
import Phaser from "phaser";
import type { TilesetManifest, ZoneMapWire } from "@celestia/jupiter";
import { loadSpriteDescriptor, type RenderBackend, type VisualSpec } from "@celestia/pictor";

const LABEL_Z = 100000; // name tags + HP bars sort above every body
const HUD_Z = LABEL_Z * 2; // HUD above everything
const FRAME_RATE = 8;

type SheetState = "loading" | "ready" | "missing";
type Handle = {
  box: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  bar?: Phaser.GameObjects.Graphics;
  sprite?: Phaser.GameObjects.Sprite;
  curAnim?: string;
};

export class PhaserBackend implements RenderBackend<Handle> {
  #status!: Phaser.GameObjects.Text;
  #ping!: Phaser.GameObjects.Text;
  #ui!: Phaser.Cameras.Scene2D.Camera; // unzoomed overlay camera for the HUD (main camera zooms the world)
  #ground: Phaser.GameObjects.GameObject[] = []; // drawn map cells (tilesheet images, or debug rects as fallback)
  #base = "";
  #scale = 1; // asset scale (1|2|3) chosen from the screen DPI → serve img/<scale> (BQ-style), draw at 1/scale
  #tileset?: TilesetManifest; // ground tileset manifest (tile value → sheet index)
  #tilesKey?: string; // loaded tilesheet texture key (undefined until the loader finishes)
  #tilePx = 0; // tile size (px) in the loaded sheet = tileSize·S
  #map?: ZoneMapWire; // last map, re-drawn when the tilesheet finishes loading
  readonly #sheets = new Map<string, SheetState>(); // one per spriteId, shared across entities of that kind

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly view: { width: number; height: number },
  ) {}

  init(): Promise<void> {
    this.#scale = Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1))); // match DPI to the art we ship
    this.#status = this.scene.add.text(8, 8, "logging in…", { color: "#9ca3af", fontSize: "14px" }).setDepth(HUD_Z);
    this.#ping = this.scene.add
      .text(this.view.width - 8, 8, "", { color: "#9ca3af", fontSize: "14px" })
      .setOrigin(1, 0)
      .setDepth(HUD_Z);
    // Two cameras: the MAIN camera zooms the world (camera()); a separate UI camera (zoom 1) renders the HUD so it
    // never scales. Main ignores the HUD; the UI camera ignores every world object (registered via #world()).
    this.#ui = this.scene.cameras.add(0, 0, this.view.width, this.view.height);
    this.scene.cameras.main.ignore([this.#status, this.#ping]);
    return Promise.resolve();
  }

  // Register a world object: the overlay (UI) camera ignores it, so only the zooming main camera draws it.
  #world<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.#ui.ignore(obj);
    return obj;
  }

  setStatus(text: string): void {
    this.#status.setText(text);
  }
  setAssets(base: string, tileset?: TilesetManifest): void {
    this.#base = base;
    this.#tileset = tileset;
    if (tileset) this.#loadTiles(tileset.id, tileset.tileSize);
  }
  setHud(text: string): void {
    this.#ping.setText(text);
  }
  camera(x: number, y: number, zoom: number): void {
    // Pictor hands a world→screen offset (px) at scale `zoom`. Phaser maps screen = (world - scroll)·zoom, so
    // setZoom(zoom) + scroll = -offset/zoom reproduces screen = zoom·world + offset exactly.
    const cam = this.scene.cameras.main;
    cam.setZoom(zoom);
    cam.setScroll(-x / zoom, -y / zoom);
  }
  // Fill a new window size: resize the UI overlay camera + re-anchor the top-right HUD (the main camera auto-
  // resizes under Phaser's RESIZE scale mode).
  resize(width: number, height: number): void {
    this.#ui.setSize(width, height);
    this.#ping.setPosition(width - 8, 8);
  }

  setMap(m: ZoneMapWire): void {
    this.#map = m;
    this.#drawMap();
  }

  // Draw the ground: one tilesheet image per cell (value → sheet frame via the manifest) once the sheet is loaded,
  // else a debug rect per cell. Portals stay a cyan overlay. All registered as world objects (UI camera ignores).
  #drawMap(): void {
    const m = this.#map;
    if (!m) return;
    for (const o of this.#ground) o.destroy();
    this.#ground = [];
    const ts = this.#tileset;
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const gIdx = m.ground ? m.ground[y][x] : ts?.tiles[String(m.tiles[y][x])];
        if (this.#tilesKey && gIdx) {
          this.#ground.push(this.#world(this.#tileImage(gIdx, x * m.tileSize, y * m.tileSize, -10)));
        } else {
          const r = this.scene.add
            .rectangle(x * m.tileSize, y * m.tileSize, m.tileSize - 1, m.tileSize - 1, m.tiles[y][x] === 1 ? 0x4b3b2a : 0x242437)
            .setOrigin(0, 0)
            .setDepth(-10);
          this.#ground.push(this.#world(r));
        }
        const oIdx = m.overlay?.[y]?.[x];
        if (this.#tilesKey && oIdx) this.#ground.push(this.#world(this.#tileImage(oIdx, x * m.tileSize, y * m.tileSize, -9)));
      }
    }
    for (const p of m.portals) {
      if (p.marker === false) continue; // portal opted out of the debug marker → render nothing (the trigger still fires server-side)
      const r = this.scene.add
        .rectangle(p.at.x * m.tileSize, p.at.y * m.tileSize, m.tileSize - 1, m.tileSize - 1, 0x22d3ee, 0.5)
        .setOrigin(0, 0)
        .setDepth(-9);
      this.#ground.push(this.#world(r));
    }
  }

  // A tilesheet image for a 1-based index (Phaser frame = idx−1, row-major), scaled from sheet tile → world cell.
  // Sized to tileSize+1 (a 1px bleed over the next cell) so there are no seams between tiles at fractional zoom.
  #tileImage(idx: number, worldX: number, worldY: number, depth: number): Phaser.GameObjects.Image {
    const cell = this.#map?.tileSize ?? this.#tilePx;
    return this.scene.add
      .image(worldX, worldY, this.#tilesKey!, idx - 1)
      .setOrigin(0, 0)
      .setDisplaySize(cell + 1, cell + 1)
      .setDepth(depth);
  }

  // Load the tilesheet as a Phaser spritesheet (scale-aware); redraw the map so the ground swaps rects → tiles.
  #loadTiles(id: string, tileSize: number): void {
    const s = this.#scale;
    const key = `tiles:${id}`;
    this.#tilePx = tileSize * s;
    this.scene.load.once(`filecomplete-spritesheet-${key}`, () => {
      this.#tilesKey = key;
      this.#drawMap();
    });
    this.scene.load.spritesheet(key, `${this.#base}/img/${s}/${id}.png`, { frameWidth: tileSize * s, frameHeight: tileSize * s });
    if (!this.scene.load.isLoading()) this.scene.load.start();
  }

  spawn(_id: string, spec: VisualSpec): Handle {
    const box = this.#world(this.scene.add.rectangle(spec.x, spec.y, spec.box.size, spec.box.size, spec.box.color, spec.box.alpha));
    const label = this.#world(
      this.scene.add
        .text(spec.x, spec.y, spec.label.text, { color: spec.label.color, fontSize: spec.kind === "player" ? "11px" : "10px" })
        .setOrigin(0.5, 1),
    );
    const h: Handle = { box, label };
    if (spec.bar) h.bar = this.#world(this.scene.add.graphics());
    this.update(h, spec);
    return h;
  }

  update(h: Handle, spec: VisualSpec): void {
    const b = spec.box;
    h.box.setPosition(spec.x, spec.y).setSize(b.size, b.size).setFillStyle(b.color, b.alpha).setDepth(spec.z);
    h.label
      .setText(spec.label.text)
      .setPosition(spec.x, spec.y - 16)
      .setDepth(LABEL_Z + spec.z)
      .setAlpha(b.alpha < 1 ? 0.4 : 1);
    if (h.bar && spec.bar) {
      const w = b.size;
      const top = -b.size / 2 - 7;
      h.bar.clear();
      h.bar.fillStyle(0x3f3f46, 1);
      h.bar.fillRect(-w / 2, top, w, 3);
      h.bar.fillStyle(spec.bar.alpha < 1 ? 0x6b7280 : 0x22c55e, 1);
      h.bar.fillRect(-w / 2, top, w * spec.bar.frac, 3);
      h.bar.setPosition(spec.x, spec.y).setDepth(LABEL_Z + spec.z);
    }

    const state = spec.sprite ? this.#sheet(spec.sprite.id) : undefined;
    if (spec.useSprite && spec.sprite && state === "ready") {
      const sp = spec.sprite; // narrowed: a loaded sheet + a requested anim
      const key = this.#animKey(sp.id, sp.anim);
      // Sheet frames are S× the base size → draw at 1/S so the sprite occupies base world units, just denser pixels.
      if (!h.sprite) {
        h.sprite = this.#world(this.scene.add.sprite(spec.x, spec.y, sp.id).setOrigin(0.5, 0.85).setScale(1 / this.#scale));
      }
      if (key && h.curAnim !== key) {
        h.sprite.play(key);
        h.curAnim = key;
      }
      h.sprite.setPosition(spec.x, spec.y).setDepth(spec.z).setFlipX(sp.flip).setVisible(true);
      h.box.setVisible(false);
    } else {
      h.sprite?.setVisible(false);
      h.box.setVisible(true);
    }
  }

  despawn(h: Handle): void {
    h.box.destroy();
    h.label.destroy();
    h.bar?.destroy();
    h.sprite?.destroy();
  }

  // Resolve the anim key to play, falling back to idle_down for a missing direction (mirrors pyxis's `frames()`)
  // so the sprite still shows instead of reverting to the box.
  #animKey(id: string, anim: string): string | undefined {
    const want = `${id}:${anim}`;
    if (this.scene.anims.exists(want)) return want;
    const idle = `${id}:idle_down`;
    return this.scene.anims.exists(idle) ? idle : undefined;
  }

  // Lazily load + slice a sprite sheet into Phaser anims (shared across entities of that id). "loading" until ready.
  #sheet(id: string): SheetState {
    const cur = this.#sheets.get(id);
    if (cur) return cur;
    this.#sheets.set(id, "loading");
    void this.#load(id);
    return "loading";
  }
  async #load(id: string): Promise<void> {
    const d = await loadSpriteDescriptor(this.#base, id);
    if (!d) {
      this.#sheets.set(id, "missing");
      return;
    }
    const s = this.#scale; // the Sx sheet: frames are S× the base size, so slice at S× (grid indices stay the same)
    // Per-file event (not COMPLETE) so concurrent sheet loads don't cross-fire.
    this.scene.load.once(`filecomplete-spritesheet-${id}`, () => {
      const src = this.scene.textures.get(id).getSourceImage();
      const cols = Math.max(1, Math.floor(src.width / (d.frameW * s)));
      for (const [name, a] of Object.entries(d.animations)) {
        const key = `${id}:${name}`;
        if (this.scene.anims.exists(key)) continue;
        const start = a.row * cols;
        this.scene.anims.create({
          key,
          frames: this.scene.anims.generateFrameNumbers(id, { start, end: start + a.length - 1 }),
          frameRate: FRAME_RATE,
          repeat: -1,
        });
      }
      this.#sheets.set(id, "ready");
    });
    this.scene.load.spritesheet(id, `${this.#base}/img/${s}/${id}.png`, { frameWidth: d.frameW * s, frameHeight: d.frameH * s });
    if (!this.scene.load.isLoading()) this.scene.load.start(); // kick the queue if idle (added mid-load otherwise)
  }
}
