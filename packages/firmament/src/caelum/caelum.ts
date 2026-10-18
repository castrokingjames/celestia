// caelum.ts — CAELUM, the world/topology loader (docs/NAMING.md; docs/REFACTOR.md S2). Reads the thin world
// manifest (config/world.json) + per-zone bundles (content/zones/<id>/zone.json + its map.json) into ONE
// validated, in-memory WorldRegistry, and VALIDATES THE GRAPH at load: every referenced zone has a bundle +
// resolvable map; every portal target resolves to a real zone + named spawn; a dangling link fails loudly
// (boot fails). Pure (no NestJS, no eager module-level load) so scripts/tests can load a fixture dir; the Nest
// wrapper (CaelumService, firmament/nest) constructs the real registry at Atlas boot. Positions are in world
// UNITS; tiles/portals are in TILE coords (unit = tile * tileSize).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { z } from "zod";

const vec2 = z.object({ x: z.number(), y: z.number() });

/** config/world.json — the thin manifest: which worlds exist, each one's zone list + starting zone. */
const worldManifestSchema = z.object({
  defaultWorldId: z.string(),
  worlds: z.record(
    z.object({
      name: z.string(),
      startingZoneId: z.string(),
      zones: z.array(z.string()).nonempty(),
    }),
  ),
});

/** content/zones/<id>/zone.json — zone knobs + a ref to its map file (relative to the bundle dir). */
const zoneFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  tickHz: z.number().int().positive(),
  maxPerChannel: z.number().int().positive(),
  map: z.string(),
});

/** content/zones/<id>/<map>.json — the dummy map: a tile grid (0=walkable, 1=box), named spawn points
 *  (world units), and portals (a trigger tile → another zone's named spawn). */
const mapFileSchema = z.object({
  width: z.number().int().positive(), // tiles
  height: z.number().int().positive(), // tiles
  tileSize: z.number().int().positive(), // world units per tile
  tiles: z.array(z.array(z.number().int())), // [y][x]
  spawns: z.record(vec2), // name -> world-unit position
  portals: z.array(
    z.object({
      at: vec2, // TILE coords of the trigger tile
      to: z.object({ zoneId: z.string(), spawn: z.string() }),
    }),
  ),
});

export type Vec2 = { x: number; y: number };
export type Portal = { at: Vec2; to: { zoneId: string; spawn: string } };
export type ZoneMap = {
  width: number;
  height: number;
  tileSize: number;
  tiles: number[][];
  spawns: Record<string, Vec2>;
  portals: Portal[];
};
export type ZoneDef = { id: string; name: string; tickHz: number; maxPerChannel: number; map: ZoneMap };
export type WorldDef = { id: string; name: string; startingZoneId: string; zoneIds: string[] };

/** The built, validated world graph — eager (loaded once at boot), zones instantiate as rooms lazily. */
export class WorldRegistry {
  constructor(
    readonly worlds: ReadonlyMap<string, WorldDef>,
    readonly zones: ReadonlyMap<string, ZoneDef>,
    readonly defaultWorldId: string,
  ) {}

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
    zones.set(zoneId, { id: zf.id, name: zf.name, tickHz: zf.tickHz, maxPerChannel: zf.maxPerChannel, map });
  }

  const registry = new WorldRegistry(worlds, zones, manifest.defaultWorldId);
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
