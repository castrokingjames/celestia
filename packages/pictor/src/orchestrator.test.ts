// Tests for the shared render orchestrator — the "ECS" system layer that pyxis, phaethon, and (later) a Godot
// backend all reuse. It's pure logic over a component map, so a recording backend proves every decision without
// any engine: id-diff, follow-camera, facing/animation, box-vs-sprite, HP bars, labels, HUD.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AssetManifest, Entity, ZoneMapWire } from "@celestia/jupiter";
import { Orchestrator } from "./orchestrator.js";
import type { RenderBackend, VisualSpec } from "./backend.js";

// A RenderBackend that records every call. The handle IS the entity id (simplest opaque H), so the latest spec
// per entity is readable via `specs.get(id)`.
class RecordingBackend implements RenderBackend<string> {
  readonly spawns: string[] = [];
  readonly despawns: string[] = [];
  readonly updated: string[] = [];
  readonly specs = new Map<string, VisualSpec>();
  camera_?: { x: number; y: number; zoom: number };
  hud?: string;
  base?: string;
  tileset?: unknown;
  map_?: ZoneMapWire;

  init(): Promise<void> {
    return Promise.resolve();
  }
  setMap(m: ZoneMapWire): void {
    this.map_ = m;
  }
  setAssets(base: string, tileset?: unknown): void {
    this.base = base;
    this.tileset = tileset;
  }
  camera(x: number, y: number, zoom: number): void {
    this.camera_ = { x, y, zoom };
  }
  setHud(text: string): void {
    this.hud = text;
  }
  spawn(id: string, spec: VisualSpec): string {
    this.spawns.push(id);
    this.specs.set(id, spec);
    return id;
  }
  update(handle: string, spec: VisualSpec): void {
    this.updated.push(handle);
    this.specs.set(handle, spec);
  }
  despawn(handle: string): void {
    this.despawns.push(handle);
  }
}

const VIEW = { width: 800, height: 600 };
function setup(): { o: Orchestrator<string>; be: RecordingBackend } {
  const be = new RecordingBackend();
  return { o: new Orchestrator(be, VIEW), be };
}
function world(...es: Entity[]): Map<string, Entity> {
  return new Map(es.map((e) => [e.id, e]));
}
function mob(over: Partial<Entity> = {}): Entity {
  return { id: "m1", kind: "rat", x: 0, y: 0, hp: 5, maxHp: 5, action: "idle", ...over };
}
function self(over: Partial<Entity> = {}): Entity {
  return { id: "@self", kind: "player", x: 0, y: 0, self: true, hp: 20, maxHp: 20, ...over };
}
// 100×16 = 1600px world (larger than the 800×600 view, so the camera scrolls + clamps).
const BIG: ZoneMapWire = { width: 100, height: 100, tileSize: 16, tiles: [], portals: [] };
const ASSETS: AssetManifest = {
  base: "/assets",
  kinds: { player: "clotharmor", rat: "rat" },
  tileset: { id: "tilesheet", tileSize: 16, tiles: { "0": 155, "1": 406 } },
};

describe("Orchestrator diff", () => {
  it("when a new entity appears, then it spawns exactly one view", () => {
    const { o, be } = setup();
    o.frame(world(mob()), "h");
    assert.deepEqual(be.spawns, ["m1"]);
  });

  it("when an entity persists across frames, then it updates and never re-spawns", () => {
    const { o, be } = setup();
    o.frame(world(mob()), "h");
    o.frame(world(mob({ x: 5 })), "h");
    assert.deepEqual(be.spawns, ["m1"]); // still just the one spawn
    assert.ok(be.updated.includes("m1"));
  });

  it("when an entity disappears, then it despawns", () => {
    const { o, be } = setup();
    o.frame(world(mob()), "h");
    o.frame(world(), "h");
    assert.deepEqual(be.despawns, ["m1"]);
  });
});

describe("Orchestrator camera", () => {
  it("when following the self player, then it centers at the fixed zoom, clamped to the map edges", () => {
    const { o, be } = setup();
    o.setScene(BIG); // 1600×1600; at zoom 2 the world is 3200px → camera scrolls + clamps
    o.frame(world(self({ x: 800, y: 600 })), "h");
    // x: round(min(0, max(800-3200, 400-800·2))) = -1200 ; y: round(min(0, max(600-3200, 300-600·2))) = -900
    assert.deepEqual(be.camera_, { x: -1200, y: -900, zoom: 2 });
  });

  it("when the zoomed map is smaller than the view, then it centers the map", () => {
    const { o, be } = setup();
    o.setScene({ width: 20, height: 15, tileSize: 20, tiles: [], portals: [] }); // 400×300 → 800×600 at zoom 2
    o.frame(world(self({ x: 200, y: 150 })), "h");
    assert.deepEqual(be.camera_, { x: 0, y: 0, zoom: 2 }); // 800×600 == view → centered at 0,0
  });

  it("when there is no self entity, then the camera is not moved", () => {
    const { o, be } = setup();
    o.setScene(BIG);
    o.frame(world(mob()), "h"); // a mob, but no self
    assert.equal(be.camera_, undefined);
  });
});

describe("Orchestrator facing + animation (sprite mode)", () => {
  function spriteSetup() {
    const s = setup();
    s.o.setScene(BIG, ASSETS);
    s.o.toggleSprites();
    return s;
  }

  it("when sprite mode is on and the entity is still, then it plays idle facing down", () => {
    const { o, be } = spriteSetup();
    o.frame(world(mob({ x: 0, y: 0 })), "h");
    const s = be.specs.get("m1")!;
    assert.equal(s.useSprite, true);
    assert.equal(s.sprite?.id, "rat");
    assert.equal(s.sprite?.anim, "idle_down");
    assert.equal(s.sprite?.flip, false);
  });

  it("when the entity moves right, then it plays walk_right un-flipped", () => {
    const { o, be } = spriteSetup();
    o.frame(world(mob({ x: 0 })), "h");
    o.frame(world(mob({ x: 10 })), "h");
    const s = be.specs.get("m1")!;
    assert.equal(s.sprite?.anim, "walk_right");
    assert.equal(s.sprite?.flip, false);
  });

  it("when the entity moves left, then it reuses the right sheet mirrored (flip)", () => {
    const { o, be } = spriteSetup();
    o.frame(world(mob({ x: 10 })), "h");
    o.frame(world(mob({ x: 0 })), "h"); // dx = -10
    const s = be.specs.get("m1")!;
    assert.equal(s.sprite?.anim, "walk_right");
    assert.equal(s.sprite?.flip, true);
  });

  it("when the entity moves up, then it faces up", () => {
    const { o, be } = spriteSetup();
    o.frame(world(mob({ y: 10 })), "h");
    o.frame(world(mob({ y: 0 })), "h"); // dy = -10
    assert.equal(be.specs.get("m1")!.sprite?.anim, "walk_up");
  });

  it("when the entity is attacking in place, then it plays the atk animation", () => {
    const { o, be } = spriteSetup();
    o.frame(world(mob({ x: 0, y: 0, action: "attack" })), "h"); // not moving → strike pose
    assert.equal(be.specs.get("m1")!.sprite?.anim, "atk_down");
  });

  it("when a mob closes on its target (moving with an attack tactic), then it walks, not strikes", () => {
    const { o, be } = spriteSetup();
    o.frame(world(mob({ x: 0, action: "attack" })), "h");
    o.frame(world(mob({ x: 12, action: "attack" })), "h"); // still chasing → moved east
    const s = be.specs.get("m1")!;
    assert.equal(s.sprite?.anim, "walk_right"); // locomotion wins over the tactic
  });

  it("when a player strikes while moving, then its deliberate attack pose still plays", () => {
    const { o, be } = spriteSetup();
    o.frame(world(self({ x: 0 })), "h");
    o.frame(world(self({ x: 12, action: "attack" })), "h"); // moving east AND striking (F pressed)
    assert.equal(be.specs.get("@self")!.sprite?.anim, "atk_right"); // a player's strike wins over locomotion
  });
});

describe("Orchestrator box vs sprite", () => {
  it("when sprite mode is off, then entities render as boxes even if a sprite is mapped", () => {
    const { o, be } = setup();
    o.setScene(BIG, ASSETS);
    o.frame(world(mob()), "h"); // sprite mode defaults OFF
    assert.equal(be.specs.get("m1")!.useSprite, false);
  });

  it("when the entity is dead, then it stays a dimmed box even in sprite mode", () => {
    const { o, be } = setup();
    o.setScene(BIG, ASSETS);
    o.toggleSprites();
    o.frame(world(mob({ hp: 0 })), "h");
    const s = be.specs.get("m1")!;
    assert.equal(s.useSprite, false);
    assert.ok(s.box.alpha < 1); // dimmed
  });

  it("when the kind has no sprite mapping, then it falls back to a generic box (no sprite)", () => {
    const { o, be } = setup();
    o.setScene(BIG, ASSETS);
    o.toggleSprites();
    o.frame(world({ id: "g", kind: "goblin", x: 0, y: 0, hp: 3, maxHp: 3 }), "h");
    const s = be.specs.get("g")!;
    assert.equal(s.sprite, undefined);
    assert.equal(s.useSprite, false);
    assert.equal(s.box.color, 0xa78bfa); // generic purple
  });

  it("when setScene carries a manifest, then the backend is told the asset base + tileset", () => {
    const { o, be } = setup();
    o.setScene(BIG, ASSETS);
    assert.equal(be.base, "/assets");
    assert.deepEqual(be.tileset, { id: "tilesheet", tileSize: 16, tiles: { "0": 155, "1": 406 } });
  });
});

describe("Orchestrator HP bar + labels", () => {
  it("when the entity is a mob, then it carries an HP bar", () => {
    const { o, be } = setup();
    o.frame(world(mob({ hp: 3, maxHp: 5 })), "h");
    assert.deepEqual(be.specs.get("m1")!.bar, { frac: 0.6, alpha: 1 });
  });

  it("when the entity is a player or a lever, then it has no HP bar", () => {
    const { o, be } = setup();
    o.frame(world(self(), { id: "l", kind: "lever", x: 0, y: 0, on: true }), "h");
    assert.equal(be.specs.get("@self")!.bar, undefined);
    assert.equal(be.specs.get("l")!.bar, undefined);
  });

  it("when the entity is the self player, then the label reads you + hp", () => {
    const { o, be } = setup();
    o.frame(world(self({ hp: 12, maxHp: 20 })), "h");
    assert.equal(be.specs.get("@self")!.label.text, "you 12/20");
  });

  it("when a mob has a non-idle action, then the label appends it", () => {
    const { o, be } = setup();
    o.frame(world(mob({ hp: 3, maxHp: 5, action: "flee" })), "h");
    assert.equal(be.specs.get("m1")!.label.text, "rat 3/5 · flee");
  });

  it("when a mob is idle, then the label omits the action tag", () => {
    const { o, be } = setup();
    o.frame(world(mob({ hp: 3, maxHp: 5, action: "idle" })), "h");
    assert.equal(be.specs.get("m1")!.label.text, "rat 3/5");
  });
});

describe("Orchestrator HUD", () => {
  it("when rendering a frame, then the HUD annotates the current render mode", () => {
    const { o, be } = setup();
    o.frame(world(), "tick 50ms");
    assert.equal(be.hud, "tick 50ms · boxes");
    o.toggleSprites();
    o.frame(world(), "tick 50ms");
    assert.equal(be.hud, "tick 50ms · sprites");
  });
});
