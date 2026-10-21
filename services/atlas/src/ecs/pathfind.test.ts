import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findPath } from "./pathfind.js";

const TS = 16;
const grid = (rows: number[][]) => ({ width: rows[0].length, height: rows.length, tileSize: TS, tiles: rows });
const at = (tx: number, ty: number) => ({ x: (tx + 0.5) * TS, y: (ty + 0.5) * TS }); // tile → centre (world units)
const tileOf = (p: { x: number; y: number }) => ({ tx: Math.floor(p.x / TS), ty: Math.floor(p.y / TS) });

describe("findPath (A* over the collision grid)", () => {
  it("when the goal is reachable in the open, then it returns a diagonal path to the goal tile", () => {
    const m = grid(Array.from({ length: 5 }, () => new Array(5).fill(0)));
    const path = findPath(m, at(0, 0), at(4, 4), 1);
    assert.ok(path, "path exists");
    assert.equal(path!.length, 4); // (1,1)(2,2)(3,3)(4,4) — start tile dropped
    assert.deepEqual(tileOf(path!.at(-1)!), { tx: 4, ty: 4 });
  });

  it("when a wall blocks the direct route, then it paths AROUND through the open gap", () => {
    const m = grid([
      [0, 0, 0, 1, 0, 0, 0],
      [0, 0, 0, 1, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0], // the only crossing of column 3 is the bottom row
    ]);
    const path = findPath(m, at(0, 1), at(6, 1), 1);
    assert.ok(path, "path exists");
    assert.ok(path!.some((p) => tileOf(p).ty === 2), "detoured through the bottom row");
    assert.deepEqual(tileOf(path!.at(-1)!), { tx: 6, ty: 1 });
  });

  it("when the goal is walled off, then it returns null", () => {
    const m = grid([
      [0, 1, 0],
      [0, 1, 0],
      [0, 1, 0], // column 1 fully separates start (left) from goal (right)
    ]);
    assert.equal(findPath(m, at(0, 1), at(2, 1), 1), null);
  });

  it("when the only gap is one tile, then a fat body can't fit but a small one can", () => {
    const m = grid([
      [0, 0, 0, 1, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0], // single-tile gap at (3,1) between the walls above and below
      [0, 0, 0, 1, 0, 0, 0],
    ]);
    assert.equal(findPath(m, at(1, 1), at(5, 1), 8), null); // r=8 body (16px) clips the walls at the gap → blocked
    assert.ok(findPath(m, at(1, 1), at(5, 1), 1), "a small body slips through");
  });

  it("when already in the goal tile, then it returns just that tile", () => {
    const m = grid(Array.from({ length: 3 }, () => new Array(3).fill(0)));
    const path = findPath(m, at(1, 1), at(1, 1), 1);
    assert.deepEqual(path, [at(1, 1)]);
  });
});
