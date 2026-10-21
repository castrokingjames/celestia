// caelum.ts — CAELUM, the world/topology loader (docs/NAMING.md; docs/REFACTOR.md S2). Reads the thin world
// manifest (config/world.json) + per-zone bundles (content/zones/<id>/zone.json + its map.json) into ONE
// validated, in-memory WorldRegistry, and VALIDATES THE GRAPH at load: every referenced zone has a bundle +
// resolvable map; every portal target resolves to a real zone + named spawn; a dangling link fails loudly
// (boot fails). Pure (no NestJS, no eager module-level load) so scripts/tests can load a fixture dir; the Nest
// wrapper (CaelumService, firmament/nest) constructs the real registry at Atlas boot. Positions are in world
// UNITS; tiles/portals are in TILE coords (unit = tile * tileSize).
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { z } from "zod";

const vec2 = z.object({ x: z.number(), y: z.number() });

/** Optional per-world ASSET MANIFEST — carried OPAQUELY by the engine (Caelum validates only that it's a base
 *  URL + a string→string map; it never interprets what a "kind" or "sprite" means — G3). The client reads it to
 *  pick art per entity kind; the engine just ferries it. (Mirrors norma's AssetManifest structurally; kept inline
 *  so firmament stays independent of the wire package.) */
const tilesetSchema = z.object({ id: z.string(), tileSize: z.number(), tiles: z.record(z.number()) });
const assetsSchema = z.object({ base: z.string(), kinds: z.record(z.string()), tileset: tilesetSchema.optional() });

/** config/world.json — the thin manifest: which worlds exist, each one's zone list + starting zone. `assets` is
 *  GLOBAL (not per-world): entity-kind → sprite is the same everywhere — a monster isn't tied to a world/location.
 *  Per-zone LOOK (tileset) lives in zone.json instead. */
// GLOBAL respawn defaults (sim knobs, not per-monster/per-zone): the scatter radius used when a spawn doesn't
// override it, and the corpse→fresh overlap window. Optional — Caelum falls back to RESPAWN_DEFAULTS if absent.
const respawnSchema = z.object({
  scatter: z.number().nonnegative(), // world units: a respawn lands within this of its anchor unless the spawn overrides it
  corpseOverlapMs: z.number().nonnegative(), // the fresh mob spawns this long BEFORE its corpse is flushed → overlap, no teleport
});
const worldManifestSchema = z.object({
  defaultWorldId: z.string(),
  assets: assetsSchema.optional(),
  respawn: respawnSchema.optional(),
  worlds: z.record(
    z.object({
      name: z.string(),
      startingZoneId: z.string(),
      zones: z.array(z.string()).nonempty(),
    }),
  ),
});

/** content/zones/<id>/zone.json — zone knobs + a ref to its map file (relative to the bundle dir), plus an optional
 *  MONSTER SPAWN table. Spawn PLACEMENT is zone config; a monster's stats/sprite are monster config (content/mobs.json). */
const zoneFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  tickHz: z.number().int().positive(),
  maxPerChannel: z.number().int().positive(),
  map: z.string(),
  // `kind` must resolve to content/mobs.json; `at` is the spawn anchor/home in WORLD units; `scatter` (optional)
  // overrides the respawn scatter radius. Validated (kind exists + in-bounds) at boot — a dangling spawn fails loudly.
  mobs: z
    .array(
      z.object({
        kind: z.string(),
        at: vec2,
        scatter: z.number().nonnegative().optional(),
      }),
    )
    .optional(),
});

/** content/zones/<id>/<map>.json — the dummy map: a tile grid (0=walkable, 1=box), named spawn points
 *  (world units), and portals (a trigger tile → another zone's named spawn). */
const mapFileSchema = z.object({
  width: z.number().int().positive(), // tiles
  height: z.number().int().positive(), // tiles
  tileSize: z.number().int().positive(), // world units per tile
  tiles: z.array(z.array(z.number().int())), // [y][x] COLLISION grid (0 walkable / 1 blocked)
  ground: z.array(z.array(z.number().int())).optional(), // [y][x] visual base-layer tilesheet indices
  overlay: z.array(z.array(z.number().int())).optional(), // [y][x] visual over-layer indices (0 = none)
  spawns: z.record(vec2), // name -> world-unit position
  portals: z.array(
    z.object({
      at: vec2, // TILE coords of the trigger tile
      to: z.object({ zoneId: z.string(), spawn: z.string() }),
      marker: z.boolean().optional(), // draw the client's debug marker on this trigger tile? default true; false = invisible
    }),
  ),
});

// content/mobs.json — the MONSTER ROSTER: per-kind client sprite + gameplay stats (DATA, not behaviour; what a
// mob DOES comes from Pallas, never a field here). Loaded + validated by Caelum; the key is the monster `kind`.
const mobStatsSchema = z.object({
  sprite: z.string(), // client asset key (kind -> art)
  level: z.number().int().nonnegative(),
  maxHp: z.number().positive(),
  damage: z.number().nonnegative(),
  radius: z.number().positive(),
  moveSpeed: z.number().nonnegative(),
  aggroRange: z.number().nonnegative(),
  attackRange: z.number().nonnegative(),
  attackCooldownMs: z.number().nonnegative(),
  decisionIntervalMs: z.number().positive(),
  respawnDelayMs: z.number().nonnegative(),
});
const mobsFileSchema = z.object({ mobs: z.record(mobStatsSchema) });

export type Vec2 = { x: number; y: number };
export type Portal = { at: Vec2; to: { zoneId: string; spawn: string }; marker?: boolean };
export type ZoneMap = {
  width: number;
  height: number;
  tileSize: number;
  tiles: number[][];
  ground?: number[][];
  overlay?: number[][];
  spawns: Record<string, Vec2>;
  portals: Portal[];
};
/** A monster's full definition (content/mobs.json): its client sprite + gameplay stats. `kind` is the roster key.
 *  Stats, NOT behaviour — what a mob DOES comes from Pallas (seeded precedents), never a field here. */
export type MobKind = {
  kind: string;
  sprite: string;
  level: number;
  maxHp: number;
  damage: number;
  radius: number;
  moveSpeed: number;
  aggroRange: number;
  attackRange: number;
  attackCooldownMs: number;
  decisionIntervalMs: number;
  respawnDelayMs: number;
};
/** One row of a zone's monster spawn table (content/zones/<id>/zone.json `mobs`): WHICH monster, its anchor/home
 *  (world units), and an optional respawn-scatter override. Placement is zone config; stats are monster config. */
export type ZoneMobSpawn = { kind: string; at: Vec2; scatter?: number };
export type ZoneDef = { id: string; name: string; tickHz: number; maxPerChannel: number; map: ZoneMap; mobs: ZoneMobSpawn[] };
/** Opaque GLOBAL asset manifest (base URL + entity-kind → sprite-id + optional ground tileset); the client
 *  interprets it, the engine just carries it. Not per-world — monsters/entities aren't location-tied. */
export type WorldAssets = {
  base: string;
  kinds: Record<string, string>;
  tileset?: { id: string; tileSize: number; tiles: Record<string, number> };
};
export type WorldDef = { id: string; name: string; startingZoneId: string; zoneIds: string[] };
/** GLOBAL respawn sim defaults (config/world.json `respawn`): scatter radius a respawn uses when its spawn doesn't
 *  override it, and the corpse→fresh overlap window. */
export type RespawnDefaults = { scatter: number; corpseOverlapMs: number };
/** Fallback when config/world.json omits `respawn` (e.g. the Caelum test fixtures). */
export const RESPAWN_DEFAULTS: RespawnDefaults = { scatter: 96, corpseOverlapMs: 300 };

/** The built, validated world graph — eager (loaded once at boot), zones instantiate as rooms lazily. */
export class WorldRegistry {
  constructor(
    readonly worlds: ReadonlyMap<string, WorldDef>,
    readonly zones: ReadonlyMap<string, ZoneDef>,
    readonly defaultWorldId: string,
    readonly assets?: WorldAssets, // GLOBAL entity-kind → sprite mapping (monsters aren't location-tied)
    readonly mobs: ReadonlyMap<string, MobKind> = new Map(), // the monster roster (content/mobs.json)
    readonly respawn: RespawnDefaults = RESPAWN_DEFAULTS, // GLOBAL respawn defaults (scatter + corpse overlap)
  ) {}

  /** A monster kind's definition (sprite + stats), or undefined for an unknown kind — the caller decides what to
   *  do (never silently spawns). Dangling zone spawns are rejected at boot, so a seeded spawn always resolves. */
  mobKind(kind: string): MobKind | undefined {
    return this.mobs.get(kind);
  }

  zone(id: string): ZoneDef | undefined {
    return this.zones.get(id);
  }

  /** The zone or throw — call sites that trust the graph (already validated at boot). */
  requireZone(id: string): ZoneDef {
    const z = this.zones.get(id);
    if (!z) throw new Error(`caelum: no such zone "${id}"`);
    return z;
  }

  /** Where a fresh character spawns (no saved placement) — the world's manifest starting zone. */
  startingZoneId(worldId: string = this.defaultWorldId): string {
    const w = this.worlds.get(worldId);
    if (!w) throw new Error(`caelum: no such world "${worldId}"`);
    return w.startingZoneId;
  }

  /** Which world a zone belongs to (first match; falls back to the default world). */
  worldIdOf(zoneId: string): string {
    for (const w of this.worlds.values()) if (w.zoneIds.includes(zoneId)) return w.id;
    return this.defaultWorldId;
  }

  /** The asset manifest the client renders a zone with (opaque; the client interprets it). Entity-kind → sprite is
   *  GLOBAL (same in any zone): the base map (e.g. `player`) merged with every monster's `sprite` from the roster,
   *  so a monster's art travels with its definition (content/mobs.json), not a separate list. A per-zone tileset
   *  will merge in here later. Undefined → the client falls back to its built-in debug rendering. */
  assetsFor(_zoneId: string): WorldAssets | undefined {
    if (!this.assets) return undefined;
    const kinds: Record<string, string> = { ...this.assets.kinds };
    for (const m of this.mobs.values()) kinds[m.kind] = m.sprite;
    return { ...this.assets, kinds };
  }
}

/** The tile a world-unit position falls in (floor-division by tileSize). */
export function tileAt(map: ZoneMap, x: number, y: number): { tx: number; ty: number } {
  return { tx: Math.floor(x / map.tileSize), ty: Math.floor(y / map.tileSize) };
}

/** Server-authoritative collision: a world-unit position is walkable iff it is in bounds and not a box tile.
 *  (Point-vs-tile for now — no AABB/sliding; docs/REFACTOR.md S2 move 4.) */
export function isWalkable(map: ZoneMap, x: number, y: number): boolean {
  const { tx, ty } = tileAt(map, x, y);
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false;
  return map.tiles[ty][tx] === 0;
}

/** The portal whose trigger tile the given world-unit position sits on, if any. */
export function portalAt(map: ZoneMap, x: number, y: number): Portal | undefined {
  const { tx, ty } = tileAt(map, x, y);
  return map.portals.find((p) => p.at.x === tx && p.at.y === ty);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

// repo root, resolved relative to this module (cwd-independent): src/caelum/caelum.ts (and dist/caelum/
// caelum.js) are both two levels under packages/firmament → up 4 → repo root.
function defaultRoot(): string {
  return fileURLToPath(new URL("../../../../", import.meta.url));
}

/** Load + validate the whole world graph from `rootDir` (defaults to the repo root). Throws on any invalid or
 *  dangling topology — the caller (CaelumService) lets that fail boot. */
export function loadWorldRegistry(rootDir: string = defaultRoot()): WorldRegistry {
  const manifest = worldManifestSchema.parse(readJson(join(rootDir, "config", "world.json")));

  const worlds = new Map<string, WorldDef>();
  for (const [id, w] of Object.entries(manifest.worlds)) {
    worlds.set(id, { id, name: w.name, startingZoneId: w.startingZoneId, zoneIds: w.zones });
  }

  // The monster roster (content/mobs.json) — optional (absent → no monsters). Loaded before zones so every zone's
  // spawn table can be checked against it: a spawn for a kind that isn't in the roster fails boot (no dangling).
  const mobs = new Map<string, MobKind>();
  const mobsPath = join(rootDir, "content", "mobs.json");
  if (existsSync(mobsPath)) {
    const mf = mobsFileSchema.parse(readJson(mobsPath));
    for (const [kind, s] of Object.entries(mf.mobs)) mobs.set(kind, { kind, ...s });
  }

  // Load every zone referenced by any world (once).
  const referenced = new Set<string>();
  for (const w of worlds.values()) for (const z of w.zoneIds) referenced.add(z);

  const zones = new Map<string, ZoneDef>();
  for (const zoneId of referenced) {
    const bundleDir = join(rootDir, "content", "zones", zoneId);
    const zf = zoneFileSchema.parse(readJson(join(bundleDir, "zone.json")));
    if (zf.id !== zoneId) {
      throw new Error(`caelum: zone bundle "${zoneId}/zone.json" declares mismatched id "${zf.id}"`);
    }
    const map = mapFileSchema.parse(readJson(join(bundleDir, zf.map)));
    validateMapShape(zoneId, map);
    const zoneMobs = zf.mobs ?? [];
    for (const sp of zoneMobs) {
      if (!mobs.has(sp.kind)) throw new Error(`caelum: zone "${zoneId}" spawns unknown monster kind "${sp.kind}" (not in content/mobs.json)`);
      if (sp.at.x < 0 || sp.at.y < 0 || sp.at.x >= map.width * map.tileSize || sp.at.y >= map.height * map.tileSize) {
        throw new Error(`caelum: zone "${zoneId}" monster spawn for "${sp.kind}" at (${sp.at.x},${sp.at.y}) is out of bounds`);
      }
    }
    zones.set(zoneId, { id: zf.id, name: zf.name, tickHz: zf.tickHz, maxPerChannel: zf.maxPerChannel, map, mobs: zoneMobs });
  }

  const registry = new WorldRegistry(worlds, zones, manifest.defaultWorldId, manifest.assets, mobs, manifest.respawn ?? RESPAWN_DEFAULTS);
  validateGraph(registry);
  return registry;
}

// Grid dimensions match width×height; tiles are 0/1; spawns are in-bounds (world units); portal triggers are
// in-bounds (tile coords).
function validateMapShape(zoneId: string, map: z.infer<typeof mapFileSchema>): void {
  if (map.tiles.length !== map.height) {
    throw new Error(`caelum: zone "${zoneId}" map has ${map.tiles.length} tile rows, expected height ${map.height}`);
  }
  for (let y = 0; y < map.height; y++) {
    const row = map.tiles[y];
    if (row.length !== map.width) {
      throw new Error(`caelum: zone "${zoneId}" map row ${y} has ${row.length} cols, expected width ${map.width}`);
    }
    for (let x = 0; x < map.width; x++) {
      if (row[x] !== 0 && row[x] !== 1) {
        throw new Error(`caelum: zone "${zoneId}" tile (${x},${y}) must be 0 (walkable) or 1 (box), got ${row[x]}`);
      }
    }
  }
  const worldW = map.width * map.tileSize;
  const worldH = map.height * map.tileSize;
  for (const [name, pos] of Object.entries(map.spawns)) {
    if (pos.x < 0 || pos.y < 0 || pos.x >= worldW || pos.y >= worldH) {
      throw new Error(`caelum: zone "${zoneId}" spawn "${name}" (${pos.x},${pos.y}) is out of world bounds ${worldW}x${worldH}`);
    }
  }
  for (const p of map.portals) {
    if (p.at.x < 0 || p.at.y < 0 || p.at.x >= map.width || p.at.y >= map.height) {
      throw new Error(`caelum: zone "${zoneId}" portal at (${p.at.x},${p.at.y}) is out of tile bounds ${map.width}x${map.height}`);
    }
  }
}

// The graph: default world exists; each world's starting zone + listed zones exist; each map has a "default"
// spawn; every portal resolves to a real target zone + a spawn that zone actually defines.
function validateGraph(reg: WorldRegistry): void {
  if (!reg.worlds.has(reg.defaultWorldId)) {
    throw new Error(`caelum: defaultWorldId "${reg.defaultWorldId}" is not a defined world`);
  }
  for (const w of reg.worlds.values()) {
    for (const zid of w.zoneIds) {
      if (!reg.zones.has(zid)) throw new Error(`caelum: world "${w.id}" references unknown zone "${zid}"`);
    }
    if (!w.zoneIds.includes(w.startingZoneId)) {
      throw new Error(`caelum: world "${w.id}" startingZoneId "${w.startingZoneId}" is not in its zone list`);
    }
  }
  for (const z of reg.zones.values()) {
    if (!z.map.spawns.default) {
      throw new Error(`caelum: zone "${z.id}" map has no "default" spawn (required for fresh characters)`);
    }
    for (const p of z.map.portals) {
      const target = reg.zones.get(p.to.zoneId);
      if (!target) {
        throw new Error(`caelum: zone "${z.id}" portal at (${p.at.x},${p.at.y}) targets unknown zone "${p.to.zoneId}"`);
      }
      if (!target.map.spawns[p.to.spawn]) {
        throw new Error(`caelum: zone "${z.id}" portal targets "${p.to.zoneId}" spawn "${p.to.spawn}" which does not exist`);
      }
    }
  }
}
