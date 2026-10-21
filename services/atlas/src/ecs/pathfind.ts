// ecs/pathfind.ts — A* over the zone's collision grid, so a mob can route AROUND obstacles (e.g. the house)
// instead of wedging against a wall with the naive step-and-slide. Pure + stateless → unit-testable.
//
// A tile is TRAVERSABLE iff a body of half-extent `r` centred on that tile's centre is body-walkable (so a wide
// mob won't be routed through a one-tile gap it can't fit). 8-directional with the octile heuristic; a diagonal
// is only allowed when both orthogonal neighbours are clear (no cutting a wall corner). Returns the waypoints
// (world-unit tile centres) from just after `start` through the `goal` tile, or null if the goal is unreachable.
import { isBodyWalkable } from "@celestia/norma";

export type Vec2 = { x: number; y: number };
type Grid = { width: number; height: number; tileSize: number; tiles: number[][] };

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const MAX_EXPAND = 6000; // safety cap on node expansions (POC maps are tiny; guards a pathological case)

export function findPath(map: Grid, start: Vec2, goal: Vec2, r: number): Vec2[] | null {
  const ts = map.tileSize;
  const W = map.width;
  const center = (x: number, y: number): Vec2 => ({ x: (x + 0.5) * ts, y: (y + 0.5) * ts });
  const inBounds = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < map.height;
  const free = (x: number, y: number): boolean => inBounds(x, y) && isBodyWalkable(map, (x + 0.5) * ts, (y + 0.5) * ts, r);

  const sx = Math.floor(start.x / ts);
  const sy = Math.floor(start.y / ts);
  const gx = Math.floor(goal.x / ts);
  const gy = Math.floor(goal.y / ts);
  if (!free(gx, gy)) return null; // the goal tile can't hold the body → no path (caller falls back to straight-line)
  if (sx === gx && sy === gy) return [center(gx, gy)]; // already in the goal tile

  const key = (x: number, y: number): number => y * W + x;
  const h = (x: number, y: number): number => {
    const dx = Math.abs(x - gx);
    const dy = Math.abs(y - gy);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy); // octile distance
  };

  const open = new Map<number, number>(); // node → f-score (frontier)
  const g = new Map<number, number>();
  const came = new Map<number, number>();
  const closed = new Set<number>();
  const sKey = key(sx, sy);
  g.set(sKey, 0);
  open.set(sKey, h(sx, sy));

  for (let expand = 0; open.size > 0 && expand < MAX_EXPAND; expand++) {
    let cur = -1;
    let bestF = Infinity;
    for (const [k, f] of open) {
      if (f < bestF) {
        bestF = f;
        cur = k;
      }
    }
    open.delete(cur);
    closed.add(cur);
    const cx = cur % W;
    const cy = (cur - cx) / W;
    if (cx === gx && cy === gy) return reconstruct(came, cur, W, ts);

    const cg = g.get(cur)!;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!free(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!free(cx + dx, cy) || !free(cx, cy + dy))) continue; // no corner-cutting
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;
      const ng = cg + (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1);
      if (ng < (g.get(nk) ?? Infinity)) {
        came.set(nk, cur);
        g.set(nk, ng);
        open.set(nk, ng + h(nx, ny));
      }
    }
  }
  return null; // walled off (or hit the expansion cap)
}

// Walk the came-from chain goal→start, emit tile centres start→goal, then drop the start tile (the mob is on it).
function reconstruct(came: Map<number, number>, goalKey: number, W: number, ts: number): Vec2[] {
  const path: Vec2[] = [];
  let k: number | undefined = goalKey;
  while (k !== undefined) {
    const x = k % W;
    const y = (k - x) / W;
    path.push({ x: (x + 0.5) * ts, y: (y + 0.5) * ts });
    k = came.get(k);
  }
  path.reverse();
  path.shift(); // the mob already stands on the start tile — the first real waypoint is the next one
  return path;
}
